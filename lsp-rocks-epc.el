;;; epc.el -*- lexical-binding: t; -*-

;; Copyright (C) 2011, 2012, 2013  Masashi Sakurai

;; Author: SAKURAI Masashi <m.sakurai at kiwanami.net>
;; Version: 0.1.1
;; Keywords: lisp, rpc
;; Package-Requires: ((emacs "28.1"))
;; URL: https://github.com/kiwanami/emacs-epc

;; This program is free software; you can redistribute it and/or modify
;; it under the terms of the GNU General Public License as published by
;; the Free Software Foundation, either version 3 of the License, or
;; (at your option) any later version.

;; This program is distributed in the hope that it will be useful,
;; but WITHOUT ANY WARRANTY; without even the implied warranty of
;; MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
;; GNU General Public License for more details.

;; You should have received a copy of the GNU General Public License
;; along with this program.  If not, see <http://www.gnu.org/licenses/>.

;;; Commentary:

;; This program is an asynchronous RPC stack for Emacs.  Using this
;; RPC stack, the Emacs can communicate with the peer process.
;; Because the protocol is S-expression encoding and consists of
;; asynchronous communications, the RPC response is fairly good.
;;
;; Current implementations for the EPC are followings:
;; - epcs.el : Emacs Lisp implementation
;; - RPC::EPC::Service : Perl implementation

;;; Code:

(require 'cl-lib)
(require 'deferred)
;; (require 'concurrent)
;; (require 'ctable)


;;==================================================
;; Utility

(defvar lsp-rocks-epc--debug-out nil)
(defvar lsp-rocks-epc--debug-buffer "*epc log*")

(defvar lsp-rocks-epc--mngr)

;;(setq lsp-rocks-epc--debug-out t)
;;(setq lsp-rocks-epc--debug-out nil)

(defun lsp-rocks-epc--log-init ()
  (when (get-buffer lsp-rocks-epc--debug-buffer)
    (kill-buffer lsp-rocks-epc--debug-buffer)))

(defun lsp-rocks-epc--log (&rest args)
  (when lsp-rocks-epc--debug-out
    (with-current-buffer
        (get-buffer-create lsp-rocks-epc--debug-buffer)
      (buffer-disable-undo)
      (goto-char (point-max))
      (insert (apply 'format args) "\n"))))

(defun lsp-rocks-epc--make-procbuf (name)
  "[internal] Make a process buffer."
  (let ((buf (get-buffer-create name)))
    (with-current-buffer buf
      (set (make-local-variable 'kill-buffer-query-functions) nil)
      (erase-buffer) (buffer-disable-undo))
    buf))

(defun lsp-rocks-epc--document-function (function docstring)
  "Document FUNCTION with DOCSTRING.  Use this for `defstruct' accessor etc."
  (put function 'function-documentation docstring))
(put 'lsp-rocks-epc--document-function 'lisp-indent-function 'defun)
(put 'lsp-rocks-epc--document-function 'doc-string-elt 2)


;;==================================================
;; Low Level Interface

(defvar lsp-rocks-epc--uid 1)

(defun lsp-rocks-epc--uid ()
  (cl-incf lsp-rocks-epc--uid))

(defvar lsp-rocks-epc--accept-process-timeout 150
  "Asynchronous timeout time. (msec)")
(defvar lsp-rocks-epc--accept-process-timeout-count 100
  "Startup function waits.
(`lsp-rocks-epc--accept-process-timeout'
* `lsp-rocks-epc--accept-process-timeout-count').
 msec for the external process getting ready.")

(put 'epc-error 'error-conditions '(error epc-error))
(put 'epc-error 'error-message "EPC Error")

(cl-defstruct lsp-rocks-epc--connection
  "Set of information for network connection and event handling.

name    : Connection name. This name is used for process and buffer names.
process : Connection process object.
buffer  : Working buffer for the incoming data.
channel : Event channels for incoming messages."
  name process buffer channel)

(lsp-rocks-epc--document-function 'lsp-rocks-epc--connection-name
  "[internal] Connection name. This name is used for process and buffer names.

\(fn EPC:CONNECTION)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--connection-process
  "[internal] Connection process object.

\(fn EPC:CONNECTION)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--connection-buffer
  "[internal] Working buffer for the incoming data.

\(fn EPC:CONNECTION)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--connection-channel
  "[internal] Event channels for incoming messages.

\(fn EPC:CONNECTION)")


(defun lsp-rocks-epc--connect (host port)
  "[internal] Connect the server, initialize the process and
return lsp-rocks-epc--connection object."
  (lsp-rocks-epc--log ">> Connection start: %s:%s" host port)
  (let* ((connection-id (lsp-rocks-epc--uid))
                 (connection-name (format "epc con %s" connection-id))
                 (connection-buf (lsp-rocks-epc--make-procbuf (format "*%s*" connection-name)))
                 (connection-process
                  (open-network-stream connection-name connection-buf host port))
                 (channel (list connection-name nil))
                 (connection (make-lsp-rocks-epc--connection
                              :name connection-name
                              :process connection-process
                              :buffer connection-buf
                              :channel channel)))
    (lsp-rocks-epc--log ">> Connection establish")
    (set-process-coding-system  connection-process 'binary 'binary)
    (set-process-filter connection-process
                        (lambda (p m)
                          (lsp-rocks-epc--process-filter connection p m)))
    (set-process-sentinel connection-process
                          (lambda (p e)
                            (lsp-rocks-epc--process-sentinel connection p e)))
    (set-process-query-on-exit-flag connection-process nil)
    connection))

;; (defun lsp-rocks-epc--connection-reset (connection)
;;   "[internal] Reset the connection for restarting the process."
;;   (cc:signal-disconnect-all (lsp-rocks-epc--connection-channel connection))
;;   connection)

(defun lsp-rocks-epc--process-sentinel (connection process msg)
  (lsp-rocks-epc--log "!! Process Sentinel [%s] : %S : %S"
           (lsp-rocks-epc--connection-name connection) process msg)
  (lsp-rocks-epc--disconnect connection))

(defun lsp-rocks-epc--net-send (connection sexp)
  (let* ((msg (encode-coding-string
               (concat (lsp-rocks-epc--prin1-to-string sexp) "\n") 'utf-8-unix))
         (string (concat (lsp-rocks-epc--net-encode-length (length msg)) msg))
         (proc (lsp-rocks-epc--connection-process connection)))
    (lsp-rocks-epc--log ">> SEND : [%S]" string)
    (process-send-string proc string)))

(defun lsp-rocks-epc--disconnect (connection)
  (let
      ((process (lsp-rocks-epc--connection-process connection))
       (buf (lsp-rocks-epc--connection-buffer connection))
       (name (lsp-rocks-epc--connection-name connection)))
    (lsp-rocks-epc--log "!! Disconnect [%s]" name)
    (when process
      (set-process-sentinel process nil)
      (delete-process process)
      (when (get-buffer buf) (kill-buffer buf)))
    (lsp-rocks-epc--log "!! Disconnected finished [%s]" name)))

(defun lsp-rocks-epc--process-filter (connection process message)
  (lsp-rocks-epc--log "INCOMING: [%s] [%S]" (lsp-rocks-epc--connection-name connection) message)
  (with-current-buffer (lsp-rocks-epc--connection-buffer connection)
    (goto-char (point-max))
    (insert message)
    (lsp-rocks-epc--process-available-input connection process)))

(defun lsp-rocks-epc--signal-connect (channel event-sym &optional callback)
  "Append an observer for EVENT-SYM of CHANNEL and return a deferred object.
If EVENT-SYM is `t', the observer receives all signals of the channel.
If CALLBACK function is given, the deferred object executes the
CALLBACK function asynchronously. One can connect subsequent
tasks to the returned deferred object."
(let ((d (if callback
               (deferred:new callback)
             (deferred:new))))
    (push (cons event-sym d)
          (cddr channel))
    d))

(defun lsp-rocks-epc--signal-send (channel event-sym &rest args)
  "Send a signal to CHANNEL. If ARGS values are given,
observers can get the values by following code:

  (lambda (event)
    (destructuring-bind
     (event-sym (args))
     event ... ))
"
  (let ((observers (cddr channel))
        (event (list event-sym args)))
    (cl-loop for i in observers
             for name = (car i)
             for d = (cdr i)
             if (or (eq event-sym name) (eq t name))
             do (deferred:callback-post d event))))

(defun lsp-rocks-epc--process-available-input (connection process)
  "Process all complete messages that have arrived from Lisp."
  (with-current-buffer (process-buffer process)
    (while (lsp-rocks-epc--net-have-input-p)
      (let ((event (lsp-rocks-epc--net-read-or-lose process))
            (ok nil))
        (lsp-rocks-epc--log "<< RECV [%S]" event)
        (unwind-protect
            (condition-case err
                (progn
                  (apply 'lsp-rocks-epc--signal-send
                         (cons (lsp-rocks-epc--connection-channel connection) event))
                  (setq ok t))
              ('error (lsp-rocks-epc--log "MsgError: %S / <= %S" err event)))
          (unless ok
            (lsp-rocks-epc--run-when-idle 'lsp-rocks-epc--process-available-input connection process)))))))

(defun lsp-rocks-epc--net-have-input-p ()
  "Return true if a complete message is available."
  (goto-char (point-min))
  (and (>= (buffer-size) 6)
       (>= (- (buffer-size) 6) (lsp-rocks-epc--net-decode-length))))

(defun lsp-rocks-epc--run-when-idle (function &rest args)
  "Call FUNCTION as soon as Emacs is idle."
  (apply #'run-at-time
         (if (featurep 'xemacs) itimer-short-interval 0)
         nil function args))

(defun lsp-rocks-epc--net-read-or-lose (_process)
  (condition-case error
      (lsp-rocks-epc--net-read)
    (error
     (debug 'error error)
     (error "net-read error: %S" error))))

(defun lsp-rocks-epc--net-read ()
  "Read a message from the network buffer."
  (goto-char (point-min))
  (let* ((length (lsp-rocks-epc--net-decode-length))
         (start (+ 6 (point)))
         (end (+ start length))
          _content)
    (cl-assert (cl-plusp length))
    (prog1 (save-restriction
             (narrow-to-region start end)
             (read (decode-coding-string
                    (buffer-string) 'utf-8-unix)))
      (delete-region (point-min) end))))

(defun lsp-rocks-epc--net-decode-length ()
  "Read a 24-bit hex-encoded integer from buffer."
  (string-to-number (buffer-substring-no-properties (point) (+ (point) 6)) 16))

(defun lsp-rocks-epc--net-encode-length (n)
  "Encode an integer into a 24-bit hex string."
  (format "%06x" n))

(defun lsp-rocks-epc--prin1-to-string (sexp)
  "Like `prin1-to-string' but don't octal-escape non-ascii characters.
This is more compatible with the CL reader."
  (with-temp-buffer
    (let (print-escape-nonascii
          print-escape-newlines
          print-length
          print-level)
      (prin1 sexp (current-buffer))
      (buffer-string))))


;;==================================================
;; High Level Interface

(cl-defstruct lsp-rocks-epc--manager
  "Root object that holds all information related to an EPC activity.

`lsp-rocks-epc--start-epc' returns this object.

title          : instance name for displaying on the `lsp-rocks-epc--controller' UI
server-process : process object for the peer
commands       : a list of (prog . args)
port           : port number
connection     : lsp-rocks-epc--connection instance
methods        : alist of method (name . function)
sessions       : alist of session (id . deferred)
exit-hook      : functions for after shutdown EPC connection"
  title server-process commands port connection methods sessions exit-hooks)

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-title
  "Instance name (string) for displaying on the `lsp-rocks-epc--controller' UI

You can modify this slot using `setf' to change the title column
in the `lsp-rocks-epc--controller' table UI.

\(fn EPC:MANAGER)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-server-process
  "Process object for the peer.

This is *not* network process but the external program started by
`lsp-rocks-epc--start-epc'.  For network process, see `lsp-rocks-epc--connection-process'.

\(fn EPC:MANAGER)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-commands
  "[internal] a list of (prog . args)

\(fn EPC:MANAGER)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-port
  "Port number (integer).

\(fn EPC:MANAGER)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-connection
  "[internal] lsp-rocks-epc--connection instance

\(fn EPC:MANAGER)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-methods
  "[internal] alist of method (name . function)

\(fn EPC:MANAGER)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-sessions
  "[internal] alist of session (id . deferred)

\(fn EPC:MANAGER)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--manager-exit-hooks
  "Hooks called after shutdown EPC connection.

Use `lsp-rocks-epc--manager-add-exit-hook' to add hook.

\(fn EPC:MANAGER)")

(cl-defstruct lsp-rocks-epc--method
  "Object to hold serving method information.

name       : method name (symbol)   ex: 'test
task       : method function (function with one argument)
arg-specs  : arg-specs (one string) ex: \"(A B C D)\"
docstring  : docstring (one string) ex: \"A test function. Return sum of A,B,C and D\"
"
  name task docstring arg-specs)

(lsp-rocks-epc--document-function 'lsp-rocks-epc--method-name
  "[internal] method name (symbol)   ex: 'test

\(fn EPC:METHOD)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--method-task
  "[internal] method function (function with one argument)

\(fn EPC:METHOD)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--method-arg-specs
  "[internal] arg-specs (one string) ex: \"(A B C D)\"

\(fn EPC:METHOD)")

(lsp-rocks-epc--document-function 'lsp-rocks-epc--method-docstring
  "[internal] docstring (one string) ex: \"A test function. Return sum of A,B,C and D\"

\(fn EPC:METHOD)")


(defvar lsp-rocks-epc--live-connections nil
  "[internal] A list of `lsp-rocks-epc--manager' objects.
those currently connect to the epc peer.
This variable is for debug purpose.")

(defun lsp-rocks-epc--live-connections-add (mngr)
  "[internal] Add the EPC manager object."
  (push mngr lsp-rocks-epc--live-connections))

(defun lsp-rocks-epc--live-connections-delete (mngr)
  "[internal] Remove the EPC manager object."
  (setq lsp-rocks-epc--live-connections (delete mngr lsp-rocks-epc--live-connections)))


(defun lsp-rocks-epc--start-epc (server-prog server-args)
  "Start the epc server program and return an lsp-rocks-epc--manager object.

Start server program SERVER-PROG with command line arguments
SERVER-ARGS.  The server program must print out the port it is
using at the first line of its stdout.  If the server prints out
non-numeric value in the first line or does not print out the
port number in three seconds, it is regarded as start-up
failure."
  (let ((mngr (lsp-rocks-epc--start-server server-prog server-args)))
    (lsp-rocks-epc--init-epc-layer mngr)
    mngr))

(defun lsp-rocks-epc--start-epc-deferred (server-prog server-args)
  "Deferred version of `lsp-rocks-epc--start-epc'"
  (deferred:nextc (lsp-rocks-epc--start-server-deferred server-prog server-args)
    #'lsp-rocks-epc--init-epc-layer))

(defun lsp-rocks-epc--server-process-name (uid)
  (format "lsp-rocks-epc--server:%s" uid))

(defun lsp-rocks-epc--server-buffer-name (uid)
  (format " *%s*" (lsp-rocks-epc--server-process-name uid)))

(defun lsp-rocks-epc--start-server (server-prog server-args)
  "[internal] Start a peer server.

Return an lsp-rocks-epc--manager instance which is set up partially."
  (let* ((uid (lsp-rocks-epc--uid))
         (process-name (lsp-rocks-epc--server-process-name uid))
         (process-buffer (get-buffer-create (lsp-rocks-epc--server-buffer-name uid)))
         (process (apply 'start-process
                         process-name process-buffer
                         server-prog server-args))
         (cont 1) port)
    (while cont
      (accept-process-output process 0 lsp-rocks-epc--accept-process-timeout t)
      (let ((port-str (with-current-buffer process-buffer
                          (buffer-string))))
        (cond
         ((string-match "^[ \n\r]*[0-9]+[ \n\r]*$" port-str)
          (setq port (string-to-number port-str)
                cont nil))
         ((< 0 (length port-str))
          (error "Server may raise an error. \
Use \"M-x lsp-rocks-epc--pop-to-last-server-process-buffer RET\" \
to see full traceback:\n%s" port-str))
         ((not (eq 'run (process-status process)))
          (setq cont nil))
         (t
          (cl-incf cont)
          (when (< lsp-rocks-epc--accept-process-timeout-count cont) ; timeout 15 seconds
            (error "Timeout server response."))))))
    (set-process-query-on-exit-flag process nil)
    (make-lsp-rocks-epc--manager :server-process process
                      :commands (cons server-prog server-args)
                      :title (mapconcat 'identity (cons server-prog server-args) " ")
                      :port port
                      :connection (lsp-rocks-epc--connect "localhost" port))))

(defun lsp-rocks-epc--start-server-deferred (server-prog server-args)
  "[internal] Same as `lsp-rocks-epc--start-server'.
But start the server asynchronously."
  (let*
      ((uid (lsp-rocks-epc--uid))
       (process-name (lsp-rocks-epc--server-process-name uid))
       (process-buffer (get-buffer-create (lsp-rocks-epc--server-buffer-name uid)))
       (process (apply 'start-process
                       process-name process-buffer
                       server-prog server-args))
       (mngr (make-lsp-rocks-epc--manager
              :server-process process
              :commands (cons server-prog server-args)
              :title (mapconcat 'identity (cons server-prog server-args) " ")))
       (cont 1) port)
    (set-process-query-on-exit-flag process nil)
    (deferred:$
      (deferred:next
        (deferred:lambda (_)
          (accept-process-output process 0 nil t)
          (let ((port-str (with-current-buffer process-buffer
                            (buffer-string))))
            (cond
             ((string-match "^[0-9]+$" port-str)
              (setq port (string-to-number port-str)
                    cont nil))
             ((< 0 (length port-str))
              (error "Server may raise an error. \
Use \"M-x lsp-rocks-epc--pop-to-last-server-process-buffer RET\" \
to see full traceback:\n%s" port-str))
             ((not (eq 'run (process-status process)))
              (setq cont nil))
             (t
              (cl-incf cont)
              (when (< lsp-rocks-epc--accept-process-timeout-count cont)
                ;; timeout 15 seconds
                (error "Timeout server response."))
              (deferred:nextc (deferred:wait lsp-rocks-epc--accept-process-timeout)
                self))))))
      (deferred:nextc it
        (lambda (_)
          (setf (lsp-rocks-epc--manager-port mngr) port)
          (setf (lsp-rocks-epc--manager-connection mngr) (lsp-rocks-epc--connect "localhost" port))
          mngr)))))

(defun lsp-rocks-epc--stop-epc (mngr)
  "Disconnect the connection for the server."
  (let* ((proc (lsp-rocks-epc--manager-server-process mngr))
         (buf (and proc (process-buffer proc))))
    (lsp-rocks-epc--disconnect (lsp-rocks-epc--manager-connection mngr))
    (when proc
      (accept-process-output proc 0 lsp-rocks-epc--accept-process-timeout t))
    (when (and proc (equal 'run (process-status proc)))
      (kill-process proc))
    (when buf  (kill-buffer buf))
    (condition-case err
        (lsp-rocks-epc--manager-fire-exit-hook mngr)
      (error (lsp-rocks-epc--log "Error on exit-hooks : %S / " err mngr)))
    (lsp-rocks-epc--live-connections-delete mngr)))

(defun lsp-rocks-epc--start-epc-debug (port)
  "[internal] Return an lsp-rocks-epc--manager instance which is set up partially."
  (lsp-rocks-epc--init-epc-layer
   (make-lsp-rocks-epc--manager :server-process nil
                     :commands (cons "[DEBUG]" nil)
                     :port port
                     :connection (lsp-rocks-epc--connect "localhost" port))))

(defun lsp-rocks-epc--args (args)
  "[internal] If ARGS is an atom, return it. If list, return the cadr of it."
  (cond
   ((atom args) args)
   (t (cadr args))))

(defun lsp-rocks-epc--init-epc-layer (mngr)
  "[internal] Connect to the server program.

Return an lsp-rocks-epc--connection instance."
  (let*
      ((mngr mngr)
       (conn (lsp-rocks-epc--manager-connection mngr))
       (channel (lsp-rocks-epc--connection-channel conn)))
    ;; dispatch incoming messages with the lexical scope
    (cl-loop for (method . body) in
      `((call
          . (lambda (args)
              (lsp-rocks-epc--log "SIG CALL: %S" args)
              (apply 'lsp-rocks-epc--handler-called-method ,mngr (lsp-rocks-epc--args args))))
         (return
           . (lambda (args)
               (lsp-rocks-epc--log "SIG RET: %S" args)
               (apply 'lsp-rocks-epc--handler-return ,mngr (lsp-rocks-epc--args args))))
         (return-error
           . (lambda (args)
               (lsp-rocks-epc--log "SIG RET-ERROR: %S" args)
               (apply 'lsp-rocks-epc--handler-return-error ,mngr (lsp-rocks-epc--args args))))
         (epc-error
           . (lambda (args)
               (lsp-rocks-epc--log "SIG EPC-ERROR: %S" args)
               (apply 'lsp-rocks-epc--handler-epc-error ,mngr (lsp-rocks-epc--args args))))
         (methods
           . (lambda (args)
               (lsp-rocks-epc--log "SIG METHODS: %S" args)
               (lsp-rocks-epc--handler-methods ,mngr (caadr args)))))
      do (lsp-rocks-epc--signal-connect channel method body))
    (lsp-rocks-epc--live-connections-add mngr)
    mngr))



(defun lsp-rocks-epc--manager-add-exit-hook (mngr hook-function)
  "Register the HOOK-FUNCTION which is called.
 after the EPC connection closed by the EPC controller UI.
HOOK-FUNCTION is a function with no argument."
  (let* ((hooks (lsp-rocks-epc--manager-exit-hooks mngr)))
    (setf (lsp-rocks-epc--manager-exit-hooks mngr) (cons hook-function hooks))
    mngr))

(defun lsp-rocks-epc--manager-fire-exit-hook (mngr)
  "[internal] Call exit-hooks functions of MNGR.

After calling hooks, this functions clears.
 the hook slot so as not to call doubly."
  (let* ((hooks (lsp-rocks-epc--manager-exit-hooks mngr)))
    (run-hooks hooks)
    (setf (lsp-rocks-epc--manager-exit-hooks mngr) nil)
    mngr))

(defun lsp-rocks-epc--manager-status-server-process (mngr)
  "[internal] Return the status of the process object for the peer process.
 If the process is nil, return nil."
  (and mngr
       (lsp-rocks-epc--manager-server-process mngr)
       (process-status (lsp-rocks-epc--manager-server-process mngr))))

(defun lsp-rocks-epc--manager-status-connection-process (mngr)
  "[internal] Return the status of the process object for the connection process."
  (and (lsp-rocks-epc--manager-connection mngr)
       (process-status (lsp-rocks-epc--connection-process
                        (lsp-rocks-epc--manager-connection mngr)))))

;; (defun lsp-rocks-epc--manager-restart-process (mngr)
;;   "[internal] Restart the process and reconnect."
;;   (cond
;;    ((null (lsp-rocks-epc--manager-server-process mngr))
;;     (error "Cannot restart this EPC process!"))
;;    (t
;;     (lsp-rocks-epc--stop-epc mngr)
;;     (let* ((cmds (lsp-rocks-epc--manager-commands mngr))
;;            (new-mngr (lsp-rocks-epc--start-server (car cmds) (cdr cmds))))
;;       (setf (lsp-rocks-epc--manager-server-process mngr)
;;             (lsp-rocks-epc--manager-server-process new-mngr))
;;       (setf (lsp-rocks-epc--manager-port mngr)
;;             (lsp-rocks-epc--manager-port new-mngr))
;;       (setf (lsp-rocks-epc--manager-connection mngr)
;;             (lsp-rocks-epc--manager-connection new-mngr))
;;       (setf (lsp-rocks-epc--manager-methods mngr)
;;             (lsp-rocks-epc--manager-methods new-mngr))
;;       (setf (lsp-rocks-epc--manager-sessions mngr)
;;             (lsp-rocks-epc--manager-sessions new-mngr))
;;       (lsp-rocks-epc--connection-reset (lsp-rocks-epc--manager-connection mngr))
;;       (lsp-rocks-epc--init-epc-layer mngr)
;;       (lsp-rocks-epc--live-connections-delete new-mngr)
;;       (lsp-rocks-epc--live-connections-add mngr)
;;       mngr))))

(defun lsp-rocks-epc--manager-send (mngr method &rest messages)
  "[internal] low-level message sending."
  (let* ((conn (lsp-rocks-epc--manager-connection mngr)))
    (lsp-rocks-epc--net-send conn (cons method messages))))

(defun lsp-rocks-epc--manager-get-method (mngr method-name)
  "[internal] Return a method object. If not found, return nil."
  (cl-loop for i in (lsp-rocks-epc--manager-methods mngr)
        if (eq method-name (lsp-rocks-epc--method-name i))
        do (cl-return i)))

(defun lsp-rocks-epc--handler-methods (mngr uid)
  "[internal] Return a list of information for registered methods."
  (let ((info (cl-loop for i in (lsp-rocks-epc--manager-methods mngr)
           collect (list
                     (lsp-rocks-epc--method-name i)
                     (or (lsp-rocks-epc--method-arg-specs i) "")
                     (or (lsp-rocks-epc--method-docstring i) "")))))
    (lsp-rocks-epc--manager-send mngr 'return uid info)))

(defun lsp-rocks-epc--handler-called-method (mngr uid name args)
  "[internal] low-level message handler for peer's calling."
  (let ((mngr mngr)
         (uid uid))
    (let* ((_methods (lsp-rocks-epc--manager-methods mngr))
           (method (lsp-rocks-epc--manager-get-method mngr name)))
      (cond
       ((null method)
        (lsp-rocks-epc--log "ERR: No such method : %s" name)
        (lsp-rocks-epc--manager-send mngr 'epc-error uid (format "EPC-ERROR: No such method : %s" name)))
       (t
        (condition-case err
            (let* ((f (lsp-rocks-epc--method-task method))
                   (ret (apply f args)))
              (cond
               ((deferred-p ret)
                (deferred:nextc ret
                  (lambda (xx) (lsp-rocks-epc--manager-send mngr 'return uid xx))))
               (t (lsp-rocks-epc--manager-send mngr 'return uid ret))))
            (error
             (lsp-rocks-epc--log "ERROR : %S" err)
             (lsp-rocks-epc--manager-send mngr 'return-error uid err))))))))

(defun lsp-rocks-epc--manager-remove-session (mngr uid)
  "[internal] Remove a session from the epc manager object."
  (cl-loop with ret = nil
        for pair in (lsp-rocks-epc--manager-sessions mngr)
        unless (eq uid (car pair))
        do (push pair ret)
        finally
        do (setf (lsp-rocks-epc--manager-sessions mngr) ret)))

(defun lsp-rocks-epc--handler-return (mngr uid args)
  "[internal] low-level message handler for normal returns."
  (let ((pair (assq uid (lsp-rocks-epc--manager-sessions mngr))))
    (cond
     (pair
      (lsp-rocks-epc--log "RET: id:%s [%S]" uid args)
      (lsp-rocks-epc--manager-remove-session mngr uid)
      (deferred:callback (cdr pair) args))
     (t ; error
      (lsp-rocks-epc--log "RET: NOT FOUND: id:%s [%S]" uid args)))))

(defun lsp-rocks-epc--handler-return-error (mngr uid args)
  "[internal] low-level message handler for application errors."
  (let ((pair (assq uid (lsp-rocks-epc--manager-sessions mngr))))
    (cond
     (pair
      (lsp-rocks-epc--log "RET-ERR: id:%s [%S]" uid args)
      (lsp-rocks-epc--manager-remove-session mngr uid)
      (deferred:errorback (cdr pair) (format "%S" args)))
     (t ; error
      (lsp-rocks-epc--log "RET-ERR: NOT FOUND: id:%s [%S]" uid args)))))

(defun lsp-rocks-epc--handler-epc-error (mngr uid args)
  "[internal] low-level message handler for epc errors."
  (let ((pair (assq uid (lsp-rocks-epc--manager-sessions mngr))))
    (cond
     (pair
      (lsp-rocks-epc--log "RET-EPC-ERR: id:%s [%S]" uid args)
      (lsp-rocks-epc--manager-remove-session mngr uid)
      (deferred:errorback (cdr pair) (list 'epc-error args)))
     (t ; error
      (lsp-rocks-epc--log "RET-EPC-ERR: NOT FOUND: id:%s [%S]" uid args)))))



(defun lsp-rocks-epc--call-deferred (mngr method-name args)
  "Call peer's method with args asynchronously. Return a deferred
object which is called with the result."
  (let ((uid (lsp-rocks-epc--uid))
        (sessions (lsp-rocks-epc--manager-sessions mngr))
        (d (deferred:new)))
    (push (cons uid d) sessions)
    (setf (lsp-rocks-epc--manager-sessions mngr) sessions)
    (lsp-rocks-epc--manager-send mngr 'call uid method-name args)
    d))

(defun lsp-rocks-epc--notice (mngr method-name args)
  "Notice peer's method with args."
  (let ((uid (lsp-rocks-epc--uid)))
    (lsp-rocks-epc--manager-send mngr 'notice uid method-name args)))

(defun lsp-rocks-epc--define-method (mngr method-name task &optional arg-specs docstring)
  "Define a method and return a deferred object which is called by the peer."
  (let* ((method (make-lsp-rocks-epc--method
                  :name method-name :task task
                  :arg-specs arg-specs :docstring docstring))
         (methods (cons method (lsp-rocks-epc--manager-methods mngr))))
    (setf (lsp-rocks-epc--manager-methods mngr) methods)
    method))

(defun lsp-rocks-epc--query-methods-deferred (mngr)
  "Return a list of information for the peer's methods.
The list is consisted of lists of strings:
 (name arg-specs docstring)."
  (let ((uid (lsp-rocks-epc--uid))
        (sessions (lsp-rocks-epc--manager-sessions mngr))
        (d (deferred:new)))
    (push (cons uid d) sessions)
    (setf (lsp-rocks-epc--manager-sessions mngr) sessions)
    (lsp-rocks-epc--manager-send mngr 'methods uid)
    d))

(defun lsp-rocks-epc--sync (mngr d)
  "Wrap deferred methods with synchronous waiting, and return the result.
If an exception is occurred, this function throws the error."
  (let* ((result 'lsp-rocks-epc--nothing)
        (send-time (float-time))
        (expected-time (+ send-time 10)))
    (deferred:$ d
      (deferred:nextc it
        (lambda (x) (setq result x)))
      (deferred:error it
        (lambda (er) (setq result (cons 'error er)))))
    (while (eq result 'lsp-rocks-epc--nothing)
      ;; (message "here %s" (current-time-string))
      (save-current-buffer
        (accept-process-output
         (lsp-rocks-epc--connection-process (lsp-rocks-epc--manager-connection mngr))
         0 lsp-rocks-epc--accept-process-timeout t))
      (setq send-time (float-time))
      (when (and expected-time (< expected-time send-time))
        (error "Timeout while waiting for response.")))
    (if (and (consp result) (eq 'error (car result)))
        (error (cdr result)) result)))

(defun lsp-rocks-epc--call-sync (mngr method-name args)
  "Call peer's method with args synchronously and return the result.
If an exception is occurred, this function throws the error."
  (lsp-rocks-epc--sync mngr (lsp-rocks-epc--call-deferred mngr method-name args)))

(defun lsp-rocks-epc--live-p (mngr)
  "Return non-nil when MNGR is an EPC manager object with a live
connection."
  (let ((proc (ignore-errors
                (lsp-rocks-epc--connection-process (lsp-rocks-epc--manager-connection mngr)))))
    (and (processp proc)
         ;; Same as `process-live-p' in Emacs >= 24:
         (memq (process-status proc) '(run open listen connect stop)))))


;;==================================================
;; Troubleshooting / Debugging support

(defun lsp-rocks-epc--pop-to-last-server-process-buffer ()
  "Open the buffer for most recently started server program process.
This is useful when you want to check why the server program
failed to start (e.g., to see its traceback / error message)."
  (interactive)
  (let ((buffer (get-buffer (lsp-rocks-epc--server-buffer-name lsp-rocks-epc--uid))))
    (if buffer
        (pop-to-buffer buffer)
      (error "No buffer for the last server process.  \
Probably the EPC connection exits correctly or you didn't start it yet."))))



;;==================================================
;; Management Interface

;; (defun lsp-rocks-epc--controller ()
;;   "Display the management interface for EPC processes and connections.
;; Process list.
;; Session status, statistics and uptime.
;; Peer's method list.
;; Display process buffer.
;; Kill sessions and connections.
;; Restart process."
;;   (interactive)
;;   (let* ((buf-name "*EPC Controller*")
;;          (buf (get-buffer buf-name)))
;;     (unless (buffer-live-p buf)
;;       (setq buf (get-buffer-create buf-name)))
;;     (lsp-rocks-epc--controller-update-buffer buf)
;;     (pop-to-buffer buf)))

;; (defun lsp-rocks-epc--controller-update-buffer (buf)
;;   "[internal] Update buffer for the current epc processes."
;;   (let* ((data (cl-loop for mngr in lsp-rocks-epc--live-connections
;;                  collect (list
;;                            (lsp-rocks-epc--manager-server-process mngr)
;;                            (lsp-rocks-epc--manager-status-server-process mngr)
;;                            (lsp-rocks-epc--manager-status-connection-process mngr)
;;                            (lsp-rocks-epc--manager-title mngr)
;;                            (lsp-rocks-epc--manager-commands mngr)
;;                            (lsp-rocks-epc--manager-port mngr)
;;                            (length (lsp-rocks-epc--manager-methods mngr))
;;                            (length (lsp-rocks-epc--manager-sessions mngr))
;;                            mngr)))
;;           (param (copy-ctbl:param ctbl:default-rendering-param))
;;           (cp
;;             (ctbl:create-table-component-buffer
;;               :buffer buf :width nil
;;               :model
;;               (make-ctbl:model
;;                 :column-model
;;                 (list (make-ctbl:cmodel :title "<Process>"       :align 'left)
;;                   (make-ctbl:cmodel :title "<Proc>"          :align 'center)
;;                   (make-ctbl:cmodel :title "<Conn>"          :align 'center)
;;                   (make-ctbl:cmodel :title " Title "         :align 'left :max-width 30)
;;                   (make-ctbl:cmodel :title " Command "       :align 'left :max-width 30)
;;                   (make-ctbl:cmodel :title " Port "          :align 'right)
;;                   (make-ctbl:cmodel :title " Methods "       :align 'right)
;;                   (make-ctbl:cmodel :title " Live sessions " :align 'right))
;;                 :data data)
;;               :custom-map lsp-rocks-epc--controller-keymap
;;               :param param)))
;;     (pop-to-buffer (ctbl:cp-get-buffer cp))))

;; (eval-when-compile ; introduce anaphoric variable `cp' and `mngr'.
;;   (defmacro lsp-rocks-epc--controller-with-cp (&rest body)
;;     `(let ((cp (ctbl:cp-get-component)))
;;        (when cp
;;          (let ((mngr (car (last (ctbl:cp-get-selected-data-row cp)))))
;;            ,@body)))))

;; (defun lsp-rocks-epc--controller-update-command ()
;;   (interactive)
;;   (lsp-rocks-epc--controller-with-cp
;;     (lsp-rocks-epc--controller-update-buffer (current-buffer))))

;; (defun lsp-rocks-epc--controller-connection-restart-command ()
;;   (interactive)
;;   (lsp-rocks-epc--controller-with-cp
;;     (let* ((proc (lsp-rocks-epc--manager-server-process mngr))
;;            (msg (format "Restart the EPC process [%s] ? " proc)))
;;       (when (and proc (y-or-n-p msg))
;;         (lsp-rocks-epc--manager-restart-process mngr)
;;         (lsp-rocks-epc--controller-update-buffer (current-buffer))))))

;; (defun lsp-rocks-epc--controller-connection-kill-command ()
;;   (interactive)
;;   (lsp-rocks-epc--controller-with-cp
;;     (let* ((proc (lsp-rocks-epc--manager-server-process mngr))
;;            (msg (format "Kill the EPC process [%s] ? " proc)))
;;       (when (and proc (y-or-n-p msg))
;;         (lsp-rocks-epc--stop-epc mngr)
;;         (lsp-rocks-epc--controller-update-buffer (current-buffer))))))

;; (defun lsp-rocks-epc--controller-connection-buffer-command ()
;;   (interactive)
;;   (lsp-rocks-epc--controller-with-cp
;;     (switch-to-buffer
;;      (lsp-rocks-epc--connection-buffer (lsp-rocks-epc--manager-connection mngr)))))

;; (defun lsp-rocks-epc--controller-methods-show-command ()
;;   (interactive)
;;   (lsp-rocks-epc--controller-with-cp
;;     (lsp-rocks-epc--controller-methods mngr)))

;; (defun lsp-rocks-epc--controller-methods (mngr)
;;   "Display a list of methods for the MNGR process."
;;   (let* ((buf-name "*EPC Controller/Methods*")
;;          (buf (get-buffer buf-name)))
;;     (unless (buffer-live-p buf)
;;       (setq buf (get-buffer-create buf-name))
;;       (with-current-buffer buf
;;         (setq buffer-read-only t)))
;;     (let ((buf buf) (mngr mngr))
;;       (deferred:$
;;         (lsp-rocks-epc--query-methods-deferred mngr)
;;         (deferred:nextc it
;;           (lambda (methods)
;;             (lsp-rocks-epc--controller-methods-update-buffer buf mngr methods)
;;             (pop-to-buffer buf)))))))

;; (defface lsp-rocks-epc--face-title
;;   '((((class color) (background light))
;;      :foreground "Slategray4" :background "Gray90" :weight bold)
;;     (((class color) (background dark))
;;      :foreground "maroon2" :weight bold))
;;   "Face for titles" :group 'epc)

;; (defun lsp-rocks-epc--controller-methods-update-buffer (buf mngr methods)
;;   "[internal] Update methods list buffer for the epc process."
;;   (with-current-buffer buf
;;     (let* ((data
;;             (cl-loop for m in methods
;;               collect (list
;;                         (car m)
;;                         (or (nth 1 m) "<Not specified>")
;;                         (or (nth 2 m) "<Not specified>"))))
;;            (param (copy-ctbl:param ctbl:default-rendering-param))
;;            cp buffer-read-only)
;;       (erase-buffer)
;;       (insert
;;        (propertize
;;         (format "EPC Process : %s\n"
;;                 (mapconcat 'identity (lsp-rocks-epc--manager-commands mngr) " "))
;;         'face 'lsp-rocks-epc--face-title) "\n")
;;       (setq cp (ctbl:create-table-component-region
;;                 :model
;;                 (make-ctbl:model
;;                  :column-model
;;                  (list (make-ctbl:cmodel :title "Method Name"      :align 'left)
;;                        (make-ctbl:cmodel :title "Arguments" :align 'left)
;;                        (make-ctbl:cmodel :title "Document"  :align 'left))
;;                  :data data)
;;                 :keymap lsp-rocks-epc--controller-methods-keymap
;;                 :param param))
;;       (set (make-local-variable 'lsp-rocks-epc--mngr) mngr)
;;       (ctbl:cp-set-selected-cell cp '(0 . 0))
;;       (ctbl:cp-get-buffer cp))))

;; (defun lsp-rocks-epc--controller-methods-eval-command ()
;;   (interactive)
;;   (let ((cp (ctbl:cp-get-component)))
;;     (when cp
;;       (let* ((method-name (car (ctbl:cp-get-selected-data-row cp)))
;;              (args (eval-minibuffer
;;                     (format "Arguments for calling [%s] : " method-name))))
;;         (deferred:$
;;           (lsp-rocks-epc--call-deferred lsp-rocks-epc--mngr method-name args)
;;           (deferred:nextc it
;;             (lambda (ret) (message "Result : %S" ret)))
;;           (deferred:error it
;;             (lambda (err) (message "Error : %S" err))))))))

;; (defun lsp-rocks-epc--define-keymap (keymap-list &optional prefix)
;;   "[internal] Keymap utility."
;;   (let ((map (make-sparse-keymap)))
;;     (mapc
;;      (lambda (i)
;;        (define-key map
;;          (if (stringp (car i))
;;              (read-kbd-macro
;;               (if prefix
;;                   (replace-regexp-in-string "prefix" prefix (car i))
;;                 (car i)))
;;            (car i))
;;          (cdr i)))
;;      keymap-list)
;;     map))

;; (defun lsp-rocks-epc--add-keymap (keymap keymap-list &optional prefix)
;;   (cl-loop with nkeymap = (copy-keymap keymap)
;;         for i in keymap-list
;;         do (define-key nkeymap
;;           (if (stringp (car i))
;;               (read-kbd-macro
;;                (if prefix
;;                    (replace-regexp-in-string "prefix" prefix (car i))
;;                  (car i)))
;;             (car i))
;;           (cdr i))
;;         finally return nkeymap))

;; (defvar lsp-rocks-epc--controller-keymap
;;   (lsp-rocks-epc--define-keymap
;;    '(
;;      ("g" . lsp-rocks-epc--controller-update-command)
;;      ("R" . lsp-rocks-epc--controller-connection-restart-command)
;;      ("D" . lsp-rocks-epc--controller-connection-kill-command)
;;      ("K" . lsp-rocks-epc--controller-connection-kill-command)
;;      ("m" . lsp-rocks-epc--controller-methods-show-command)
;;      ("C-m" . lsp-rocks-epc--controller-methods-show-command)
;;      ("B" . lsp-rocks-epc--controller-connection-buffer-command)))
;;   "Keymap for the controller buffer.")

;; (defvar lsp-rocks-epc--controller-methods-keymap
;;   (lsp-rocks-epc--add-keymap
;;    ctbl:table-mode-map
;;    '(
;;      ("q" . bury-buffer)
;;      ("e" . lsp-rocks-epc--controller-methods-eval-command)))
;;   "Keymap for the controller methods list buffer.")

(provide 'lsp-rocks-epc)
;;; lsp-rocks-epc.el ands here
