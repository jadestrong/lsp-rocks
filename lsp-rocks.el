;;; lsp-rocks.el --- LSP Rocks                          -*- lexical-binding: t; -*-

;; Copyright (C) 2021  vritser

;; Author: vritser <vritser@gmail.com>
;; Keywords: LSP

;; This program is free software; you can redistribute it and/or modify
;; it under the terms of the GNU General Public License as published by
;; the Free Software Foundation, either version 3 of the License, or
;; (at your option) any later version.

;; This program is distributed in the hope that it will be useful,
;; but WITHOUT ANY WARRANTY; without even the implied warranty of
;; MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
;; GNU General Public License for more details.

;; You should have received a copy of the GNU General Public License
;; along with this program.  If not, see <https://www.gnu.org/licenses/>.

;;; Commentary:

;;

;;; Code:
(require 'cl-lib)
(require 'json)
(require 'seq)
(require 's)
(require 'subr-x)
(require 'lsp-rocks-xref)
(require 'posframe)
(require 'markdown-mode)
(require 'company)
(require 'epc)
(require 'yasnippet nil t)
(require 'flycheck)

(defvar lsp-rocks-mode) ;; properly defined by define-minor-mode below
(declare-function projectile-project-root "ext:projectile")
(declare-function yas-expand-snippet "ext:yasnippet")
(declare-function flycheck-buffer "ext:flycheck")

(defvar yas-inhibit-overlay-modification-protection)
(defvar yas-indent-line)
(defvar yas-wrap-around-region)
(defvar yas-also-auto-indent-first-line)

(defvar lsp-rocks-process nil
  "The LSP-ROCKS Process.")

(defvar lsp-rocks-is-started nil
  "Is the Server is started.")

;; (defvar lsp-rocks-started-hook nil
;;   "Hook for server started.")

(defvar lsp-rocks-node-file (expand-file-name "cli.ts" (if load-file-name
                                                           (file-name-directory load-file-name)
                                                         default-directory)))
(defun lsp-rocks--is-dark-theme ()
  "Return t if the current Emacs theme is a dark theme."
  (eq (frame-parameter nil 'background-mode) 'dark))

(defvar lsp-rocks-server-port nil)

(cl-defmacro lsp-rocks--with-file-buffer (filename &rest body)
  "Evaluate BODY in buffer with FILENAME."
  (declare (indent 1))
  `(cl-dolist (buffer (buffer-list))
     (when-let* ((file-name (buffer-file-name buffer))
                 (match-buffer (or (string-equal file-name ,filename)
                                   (string-equal (file-truename file-name) ,filename))))
       (with-current-buffer buffer
         ,@body)
       (cl-return))))

(defun lsp-rocks--get-emacs-func-result-func (sexp-string)
  "Eval SEXP-STRING, and return the result."
  (eval (read sexp-string)))

(defun lsp-rocks--eval-in-emacs-func (sexp-string)
  "Eval SEXP-STRING."
  ;; 当存在中文时， read 无法正常读取中文
  (eval (car (car (read-from-string (format "%s" sexp-string)))))
  ;; (eval (read sexp-string))
  ;; Return nil to avoid epc error `Got too many arguments in the reply'.
  nil)

(defun lsp-rocks--get-emacs-var-func (var-name)
  "Get the VAR-NAME variable and return the value."
  (let* ((var-symbol (intern var-name))
         (var-value (symbol-value var-symbol))
         ;; We need convert result of booleanp to string.
         ;; Otherwise, python-epc will convert all `nil' to [] at Python side.
         (var-is-bool (prin1-to-string (booleanp var-value))))
    (list var-value var-is-bool)))

(defun lsp-rocks--get-emacs-vars-func (&rest vars)
  "Get VARS and return values."
  (mapcar #'lsp-rocks--get-emacs-var-func vars))

(defcustom lsp-rocks-name "*lsp-rocks*"
  "Name of LSP-ROCKS buffer."
  :type 'string
  :group 'lsp-rocks)

(defcustom lsp-rocks-node-command "ts-node"
  "The Python interpreter used to run cli.ts."
  :type 'string
  :group 'lsp-rocks)

(defun lsp-rocks--user-emacs-directory ()
  "Get lang server with project path, file path or file extension."
  (expand-file-name user-emacs-directory))

(defvar lsp-rocks-is-starting nil)
(defvar lsp-rocks-first-call-method nil)
(defvar lsp-rocks-first-call-args nil)

(defun lsp-rocks--start-epc ()
  "Function to start the EPC."
  (unless (epc:live-p lsp-rocks-process)
    (setq lsp-rocks-process (epc:start-epc
                             lsp-rocks-node-command
                             (list lsp-rocks-node-file)))
    (epc:define-method lsp-rocks-process 'eval-in-emacs 'lsp-rocks--eval-in-emacs-func)
    (epc:define-method lsp-rocks-process 'get-emacs-var 'lsp-rocks--get-emacs-var-func)
    (epc:define-method lsp-rocks-process 'get-emacs-vars 'lsp-rocks--get-emacs-vars-func)
    (epc:define-method lsp-rocks-process 'get-user-emacs-directory 'lsp-rocks--user-emacs-directory)
    (epc:define-method lsp-rocks-process 'get-emacs-func-result 'lsp-rocks--get-emacs-func-result-func))
  lsp-rocks-process)

(defun lsp-rocks--toggle-trace-io ()
  "Toggle client-server protocol logging."
  (interactive)
  (lsp-rocks-call-async "lsp-rocks--toggle-trace-io"))

(defun lsp-rocks--open-elrpc-log ()
  "Open elrpc log file."
  (interactive)
  (let ((logfile (lsp-rocks-call-sync "get-elrpc-logfile")))
    (if (file-exists-p logfile)
        (find-file logfile)
      (user-error "No such log file %s" logfile))))

(defun lsp-rocks--log (&rest params)
  "Log there PARAMS to a buffer."
  (with-current-buffer (get-buffer-create lsp-rocks-name)
    (goto-char (point-max))
    (dolist (param params)
      (insert (concat (if (string-match-p "^\"" param) (read param) param) "\n")))
    (insert "\n")))

(defun lsp-rocks-call-async (method &rest args)
  "Call NODE EPC function METHOD and ARGS asynchronously."
  (if (epc:live-p lsp-rocks-process)
      (deferred:$
       (epc:call-deferred lsp-rocks-process (read method) args))
    ;; (error "[MD-PREVIEW] lsp-rocks-process not live!")
    (setq lsp-rocks-first-call-method method)
    (setq lsp-rocks-first-call-args args)
    (lsp-rocks-start-process)))

(defun lsp-rocks-call-sync (method &rest args)
  "Call NODE EPC function METHOD and ARGS synchronously."
  (epc:call-sync lsp-rocks-process (read method) args))

(defun lsp-rocks-restart-process ()
  "Stop and restart LSP-ROCKS process."
  (interactive)
  (setq lsp-rocks-is-starting nil)

  (lsp-rocks-kill-process)
  (lsp-rocks-start-process)
  (message "[LSP-ROCKS] Process restarted."))

(defun lsp-rocks-start-process ()
  "Start LSP-ROCKS process if it isn't started."
  (setq lsp-rocks-is-starting t)
  (unless (epc:live-p lsp-rocks-process)
    (lsp-rocks--start-epc)
    (message "[LSP-ROCKS] EPC Server started successly.")
    (setq lsp-rocks-is-starting nil)
    (setq lsp-rocks-is-started t)
    (lsp-rocks-register-internal-hooks)
    (lsp-rocks--did-open)))

(defvar lsp-rocks-stop-process-hook nil)

(defun lsp-rocks-kill-process ()
  "Stop LSP-ROCKS process and kill all LSP-ROCKS buffers."
  (interactive)
  ;; Run stop process hooks.
  (run-hooks 'lsp-rocks-stop-process-hook)

  ;; Kill process after kill buffer, make application can save session data.
  (lsp-rocks--kill-node-process)
  (setq lsp-rocks-is-started nil))

(add-hook 'kill-emacs-hook #'lsp-rocks-kill-process)

(defun lsp-rocks--kill-node-process ()
  "Kill LSP-ROCKS background python process."
  (when (epc:live-p lsp-rocks-process)
    ;; Cleanup before exit LSP-ROCKS server process.
    (lsp-rocks-call-async "cleanup")
    ;; Delete LSP-ROCKS server process.
    (epc:stop-epc lsp-rocks-process)
    ;; Kill *lsp-rocks* buffer.
    (when (get-buffer lsp-rocks-name)
      (kill-buffer lsp-rocks-name))
    (setq lsp-rocks-process nil)
    (message "[LSP-ROCKS] Process terminated.")))

(defgroup lsp-rocks nil
  "LSP-Rocks group."
  :group 'applications)

(defcustom lsp-rocks-server-bin (concat (substring load-file-name 0 (s-index-of "lsp-rocks.el" load-file-name)) "lib/cli.js")
  "Location of lsp-rocks server."
  :type 'string
  :group 'lsp-rocks)

(defcustom lsp-rocks-name "*lsp-rocks*"
  "LSP-Rocks process buffer."
  :type 'string
  :group 'lsp-rocks)

(defcustom lsp-rocks-server-host "0.0.0.0"
  "LSP-Rocks server host."
  :type 'string
  :group 'lsp-rocks)

(defvar lsp-rocks--server-port nil)

(defvar lsp-rocks--server-process nil)

(defcustom lsp-rocks-mark-ring-max-size 16
  "Maximum size of lsp-rocks mark ring.  \
Start discarding off end if gets this big."
  :type 'integer
  :group 'lsp-rocks)

(defcustom lsp-rocks-flash-line-delay .3
  "How many seconds to flash `lsp-rocks-font-lock-flash' after navigation.

Setting this to nil or 0 will turn off the indicator."
  :type 'number
  :group 'lsp-rocks)

(defface lsp-rocks-font-lock-flash
  '((t (:inherit highlight)))
  "Face to flash the current line."
  :group 'lsp-rocks)

(defvar lsp-rocks--mark-ring nil
  "The list of saved lsp-rocks marks, most recent first.")

(defvar lsp-rocks--last-prefix nil)

(defvar lsp-rocks--websocket-clients (make-hash-table :test 'equal :size 16)
  "LSP-Rocks websocket connection.")

(defvar lsp-rocks--recent-requests (make-hash-table :test 'equal :size 32)
  "LSP-Rocks websocket connection.")

(defvar lsp-rocks--xref-callback nil
  "XREF callback.")

(defvar lsp-rocks--company-callback nil
  "Company callback.")

(defvar-local lsp-rocks-diagnostics--flycheck-enabled nil
  "True when lsp-rocks diagnostics flycheck integration has been enabled in this buffer.")

(defvar-local lsp-rocks-diagnostics--flycheck-checker nil
  "The value of flycheck-checker before lsp-rocks diagnostics was activated.")

(defvar lsp-rocks-language-server-configuration
  (list (list 'rust-mode (list :name "rust" :command "rust-analyzer" :args (vector)))
        (list 'python-mode (list :name "python" :command "pyright-langserver" :args (vector "--stdio")))
        (list 'java-mode (list :name "java" :command "jdtls" :args (vector)))
        (list 'typescript-mode (list :name "typescript" :command "typescript-language-server" :args (vector "--stdio")))
        ;; (list 'tsx-ts-mode (list :name "tailwindcss" :command "tailwindcss-language-server" :args (list "--stdio")))
        (list 'tsx-ts-mode (list "tailwindcss" "eslint"))
        ))

(defvar lsp-rocks-language-id-map
  '((".vue" . "vue")
    (".tsx" . "typescriptreact")
    (".ts" . "typescript")
    (".jsx" . "javascriptreact")
    (".js" . "javascript")
    (".html" . "html")
    (".css" . "css")
    (".json" . "json")
    (".less" . "less")
    (".rs" . "rust")))

(defun lsp-rocks-get-language-for-file ()
  "Get the language for the current file based on its extension."
  (let ((extension (file-name-extension buffer-file-name)))
    (cdr (assoc (concat "." extension) lsp-rocks-language-id-map))))

(defvar-local lsp-rocks--before-change-begin-pos nil)

(defvar-local lsp-rocks--before-change-end-pos nil)

(defvar-local lsp-rocks--current-file-version 0)

(defconst lsp-rocks--kind->symbol
  '((1 . text)
    (2 . method)
    (3 . function)
    (4 . constructor)
    (5 . field)
    (6 . variable)
    (7 . class)
    (8 . interface)
    (9 . module)
    (10 . property)
    (11 . unit)
    (12 . value)
    (13 . enum)
    (14 . keyword)
    (15 . snippet)
    (16 . color)
    (17 . file)
    (18 . reference)
    (19 . folder)
    (20 . enum-member)
    (21 . constant)
    (22 . struct)
    (23 . event)
    (24 . operator)
    (25 . type-parameter)))

(defun lsp-rocks--suggest-project-root ()
  "Get project root."
  (or
   (when (featurep 'projectile)
     (condition-case nil
         (projectile-project-root)
       (error nil)))
   (when (featurep 'project)
     (when-let ((project (project-current)))
       (if (fboundp 'project-root)
           (project-root project)
         (car (with-no-warnings
                (project-roots project))))))
   default-directory))

(defvar lsp-rocks--already-widened nil)
(defmacro lsp-rocks--save-restriction-and-excursion (&rest form)
  (declare (indent 0) (debug t))
  `(if lsp-rocks--already-widened
       (save-excursion ,@form)
     (let* ((lsp-rocks--already-widened t))
       (save-restriction
         (widen)
         (save-excursion ,@form)))))

(defun lsp-rocks--buffer-content ()
  "Return whole content of the current buffer."
  (lsp-rocks--save-restriction-and-excursion
    (buffer-substring-no-properties (point-min) (point-max))))

(defun lsp-rocks--buffer-language-conf ()
  "Get language corresponding current buffer."
  (cl-some (lambda (it)
             (let ((mode-or-pattern (car it)))
               (cond
                ((and (stringp mode-or-pattern)
                      (s-matches? mode-or-pattern (buffer-file-name))) (cadr it))
                ((eq mode-or-pattern major-mode) (cadr it)))))
           lsp-rocks-language-server-configuration))

(defun lsp-rocks--init ()
  (let* ((config (lsp-rocks--buffer-language-conf))
         (language (plist-get config :name))
         ;; (command (plist-get config :command))
         ;; (args (plist-get config :args))
         )
    (list :project (lsp-rocks--suggest-project-root)
          :language language
          ;; :command command
          ;; :args args
          :clientInfo (list :name "Emacs" :version (emacs-version)))))

(defun lsp-rocks--message-handler (msg)
  (let* (
         ;; (msg (lsp-rocks--json-parse (websocket-frame-payload frame)))
         (id (plist-get msg :id))
         (cmd (plist-get msg :cmd))
         (params (plist-get msg :params))
         (data (plist-get msg :data)))
    (when (string= id (gethash cmd lsp-rocks--recent-requests))
      (pcase cmd
        ("get_var" (lsp-rocks--response id cmd (list :value (symbol-value (intern (plist-get params :name))))))
        ("textDocument/completion" (lsp-rocks--process-completion data))
        ("completionItem/resolve" (lsp-rocks--process-completion-resolve data))
        ("textDocument/definition" (lsp-rocks--process-find-definition data))
        ("textDocument/typeDefinition" (lsp-rocks--process-find-definition data))
        ("textDocument/declaration" (lsp-rocks--process-find-definition data))
        ("textDocument/references" (lsp-rocks--process-find-definition data))
        ("textDocument/implementation" (lsp-rocks--process-find-definition data))
        ("textDocument/hover" (lsp-rocks--process-hover data))
        ("textDocument/signatureHelp" (lsp-rocks--process-signature-help data))
        ("textDocument/prepareRename" (lsp-rocks--process-prepare-rename data))
        ("textDocument/rename" (lsp-rocks--process-rename data))
        ("textDocument/formatting" (lsp-rocks--process-formatting data))
        ))))


(defvar-local lsp-rocks-enable-relative-indentation nil
  "Enable relative indentation when insert texts, snippets ...
from language server.")

(defun lsp-rocks--expand-snippet (snippet &optional start end expand-env)
  "Wrapper of `yas-expand-snippet' with all of it arguments.
The snippet will be convert to LSP style and indent according to
LSP server according to
LSP server result."
  (let* ((inhibit-field-text-motion t)
         (yas-wrap-around-region nil)
         (yas-indent-line 'none)
         (yas-also-auto-indent-first-line nil))
    (yas-expand-snippet snippet start end expand-env)))

(defun lsp-rocks--indent-lines (start end &optional insert-text-mode?)
  "Indent from START to END based on INSERT-TEXT-MODE? value.
- When INSERT-TEXT-MODE? is provided
  - if it's `lsp/insert-text-mode-as-it', do no editor indentation.
  - if it's `lsp/insert-text-mode-adjust-indentation', adjust leading
    whitespaces to match the line where text is inserted.
- When it's not provided, using `indent-line-function' for each line."
  (save-excursion
    (goto-char end)
    (let* ((end-line (line-number-at-pos))
           (offset (save-excursion
                     (goto-char start)
                     (current-indentation)))
           (indent-line-function
            (cond ((eql insert-text-mode? 1)
                   #'ignore)
                  ((or (equal insert-text-mode? 2)
                       lsp-rocks-enable-relative-indentation
                       ;; Indenting snippets is extremely slow in `org-mode' buffers
                       ;; since it has to calculate indentation based on SRC block
                       ;; position.  Thus we use relative indentation as default.
                       (derived-mode-p 'org-mode))
                   (lambda () (save-excursion
                                (beginning-of-line)
                                (indent-to-column offset))))
                  (t indent-line-function))))
      (goto-char start)
      (forward-line)
      (while (and (not (eobp))
                  (<= (line-number-at-pos) end-line))
        (funcall indent-line-function)
        (forward-line)))))

(defun lsp-rocks--sort-edits (edits)
  (sort edits #'(lambda (edit-a edit-b)
                  (let* ((range-a (plist-get edit-a :range))
                         (range-b (plist-get edit-b :range))
                         (start-a (plist-get range-a :start))
                         (start-b (plist-get range-b :start))
                         (end-a (plist-get range-a :end))
                         (end-b (plist-get range-a :end))
                         )
                    (if (lsp-rocks--position-equal start-a start-b)
                        (lsp-rocks--position-compare end-a end-b)
                      (lsp-rocks--position-compare start-a start-b))))))

(defun lsp-rocks--apply-text-edit (edit)
  "Apply the edits ddescribed in the TextEdit objet in TEXT-EDIT."
  (let* ((start (lsp-rocks--position-point (plist-get (plist-get edit :range) :start)))
         (end (lsp-rocks--position-point (plist-get (plist-get edit :range) :end)))
         (new-text (plist-get edit :newText)))
    (setq new-text (s-replace "\r" "" (or new-text "")))
    (plist-put edit :newText new-text)
    (goto-char start)
    (delete-region start end)
    (insert new-text)))

(defun lsp-rocks--apply-text-edit-replace-buffer-contents (edit)
  "Apply the edits described in the TextEdit object in TEXT-EDIT.
The method uses `replace-buffer-contents'."
  (let* (
         (source (current-buffer))
         (new-text (plist-get edit :newText))
         (region (lsp-rocks--range-region (plist-get edit :range)))
         (beg (car region))
         (end (cdr region))
         ;; ((beg . end) (lsp--range-to-region (lsp-make-range :start (lsp--fix-point start)
         ;;                                      :end (lsp--fix-point end))))
         )
    (setq new-text (s-replace "\r" "" (or new-text "")))
    (plist-put edit :newText new-text)
    (with-temp-buffer
      (insert new-text)
      (let ((temp (current-buffer)))
        (with-current-buffer source
          (save-excursion
            (save-restriction
              (narrow-to-region beg end)

              ;; On emacs versions < 26.2,
              ;; `replace-buffer-contents' is buggy - it calls
              ;; change functions with invalid arguments - so we
              ;; manually call the change functions here.
              ;;
              ;; See emacs bugs #32237, #32278:
              ;; https://debbugs.gnu.org/cgi/bugreport.cgi?bug=32237
              ;; https://debbugs.gnu.org/cgi/bugreport.cgi?bug=32278
              (let ((inhibit-modification-hooks t)
                    (length (- end beg)))
                (run-hook-with-args 'before-change-functions
                                    beg end)
                (replace-buffer-contents temp)
                (run-hook-with-args 'after-change-functions
                                    beg (+ beg (length new-text))
                                    length)))))))))

(defun lsp-rocks--apply-text-edits (edits)
  "Apply the EDITS described in the TextEdit[] object."
  (unless (seq-empty-p edits)
    (atomic-change-group
      (let* ((change-group (prepare-change-group))
             (howmany (length edits))
             (message (format "Applying %s edits to `%s' ..." howmany (current-buffer)))
             (_ (message message))
             (reporter (make-progress-reporter message 0 howmany))
             (done 0))
        (unwind-protect
            (dolist (edit (lsp-rocks--sort-edits (reverse edits)))
              (progress-reporter-update reporter (cl-incf done))
              (lsp-rocks--apply-text-edit-replace-buffer-contents edit)
              (when-let* ((insert-text-format (plist-get edit :insertTextFormat))
                          (start (lsp-rocks--position-point (plist-get (plist-get edit :range) :start)))
                          (new-text (plist-get edit :newText)))
                (when (eq insert-text-format 2)
                  ;; No `save-excursion' needed since expand snippet will change point anyway
                  (goto-char (+ start (length new-text)))
                  (lsp-rocks--indent-lines start (point))
                  (lsp-rocks--expand-snippet new-text start (point)))))
          (undo-amalgamate-change-group change-group)
          (progress-reporter-done reporter))))))

(defun lsp-rocks--company-post-completion (candidate)
  "Replace a CompletionItem's label with its insertText.  Apply text edits.

CANDIDATE is a string returned by `company-lsp--make-candidate'."
  (let* ((completion-item (get-text-property 0 'lsp-rocks--item candidate))
          (resolved-item (get-text-property 0 'resolved-item candidate))
          (source (plist-get completion-item :source)))
    (if (equal source "ts-ls")
      (if resolved-item
        (lsp-rocks--compoany-post-completion-item resolved-item candidate)
        (deferred:$
          (lsp-rocks--async-resolve (plist-get completion-item :no))
          (deferred:nextc it
            (lambda (resolved)
              (put-text-property 0 (length candidate) 'resolved-item resolved candidate)
              (lsp-rocks--compoany-post-completion-item (or resolved completion-item) candidate)))))
      (lsp-rocks--compoany-post-completion-item (or resolved-item completion-item) candidate))))

(defun lsp-rocks--compoany-post-completion-item (item candidate)
  "Complete ITEM."
  (let* ((label (plist-get item :label))
          (insertText (plist-get item :insertText))
          ;; 1 = plaintext, 2 = snippet
          (insertTextFormat (plist-get item :insertTextFormat))
          (textEdit (plist-get item :textEdit))
          (additionalTextEdits (plist-get item :additionalTextEdits))
          (startPoint (- (point) (length candidate)))
          (insertTextMode (plist-get item :insertTextMode)))
    (delete-region startPoint (point))
    (cond (textEdit
            (insert lsp-rocks--last-prefix)
            (lsp-rocks--apply-text-edit textEdit)
            ;; (let ((range (plist-get textEdit :range))
            ;;       (newText (plist-get textEdit :newText)))
            ;;   (pcase-let ((`(,beg . ,end)
            ;;                (lsp-rocks--range-region range)))
            ;;     (delete-region beg end)
            ;;     (goto-char beg)
            ;;     (funcall (or snippet-fn #'insert) newText)))
            )
      ;; (snippet-fn
      ;; A snippet should be inserted, but using plain
      ;; `insertText'.  This requires us to delete the
      ;; whole completion, since `insertText' is the full
      ;; completion's text.
      ;; (delete-region (- (point) (length candidate)) (point))
      ;; (funcall snippet-fn (or insertText label)))
      ((or insertText label)
        ;; (delete-region (- (point) (length candidate)) (point))
        (insert (or insertText label))))
    (lsp-rocks--indent-lines startPoint (point) insertTextMode)
    (when (eq insertTextFormat 2)
      (lsp-rocks--expand-snippet (buffer-substring startPoint (point))
        startPoint
        (point)))
    ;; (message "additional--- %S %s" additionalTextEdits (get-text-property 0 'resolved-item candidate))
    (if (cl-plusp (length additionalTextEdits))
      (lsp-rocks--apply-text-edits additionalTextEdits)
      (if-let ((resolved-item (get-text-property 0 'resolved-item candidate)))
        (if-let (additionalTextEdits (plist-get resolved-item :additionalTextEdits))
          (lsp-rocks--apply-text-edits additionalTextEdits))
        (message "Not resolved")))))

(defun lsp-rocks--get-match-buffer-by-filepath (name)
  (cl-dolist (buffer (buffer-list))
    (with-current-buffer buffer
      (when-let* ((file-name (buffer-file-name buffer))
                  (match-buffer (or (string-equal file-name name)
                                    (string-equal (file-truename file-name) name))))
        (cl-return buffer)))))

(defun lsp-rocks--record-trigger-characters (filename trigger-characters)
  (when-let ((buffer (lsp-rocks--get-match-buffer-by-filepath filename)))
    (with-current-buffer buffer
      (setq-local lsp-rocks--completion-trigger-characters trigger-characters))))

(defun lsp-rocks--looking-back-trigger-characterp (trigger-characters)
  "Return character if text before point match any of the TRIGGER-CHARACTERS."
  (unless (= (point) (line-beginning-position))
    (cl-some
     (lambda (trigger-char)
       (and (equal (buffer-substring-no-properties (- (point) (length trigger-char)) (point))
                   trigger-char)
            trigger-char))
     trigger-characters)))

(defun lsp-rocks--get-prefix ()
  (when (and lsp-rocks-mode lsp-rocks-is-started)
    (if (lsp-rocks--looking-back-trigger-characterp lsp-rocks--completion-trigger-characters)
        (cons (company-grab-symbol) t)
      (company-grab-symbol))))

(defun company-lsp-rocks (command &optional arg &rest ignored)
  "`company-mode' completion backend existing file names.
Completions works for proper absolute and relative files paths.
File paths with spaces are only supported inside strings."
  (interactive (list 'interactive))
  (cl-case command
    (interactive (company-begin-backend 'company-lsp-rocks))
    (prefix (lsp-rocks--get-prefix))
    (candidates (cons :async (lambda (callback)
                               (setq lsp-rocks--company-callback callback
                                     lsp-rocks--last-prefix arg)
                               (lsp-rocks--completion))))
    (no-cache t)
    (sorted t)
    (annotation (lsp-rocks--candidate-kind arg))
    (doc-buffer (lsp-rocks--doc-buffer arg))
    (quickhelp-string (lsp-rocks--doc-buffer arg))
    (meta (get-text-property 0 'detail arg))
    (post-completion (lsp-rocks--company-post-completion arg))))

;;; request functions
(defun lsp-rocks--open-params ()
  (list :textDocument
    (list :uri buffer-file-name
      :languageId (lsp-rocks-get-language-for-file) ;;(string-replace "-mode" "" (symbol-name major-mode))
      :version 0
      :text (buffer-substring-no-properties (point-min) (point-max)))))

(defun lsp-rocks--did-open ()
  (if buffer-file-name
      (lsp-rocks--request "textDocument/didOpen" (lsp-rocks--open-params))))

(defun lsp-rocks--did-close ()
  "Send textDocument/didClose notification."
  (lsp-rocks--request "textDocument/didClose" (lsp-rocks--TextDocumentIdentifier)))

(defun lsp-rocks--did-change (begin end len)
  "Send textDocument/didChange notification."
  (lsp-rocks--request "textDocument/didChange"
                      (list :textDocument
                            (list :uri buffer-file-name :version lsp-rocks--current-file-version)
                            :contentChanges
                            (list
                             (list :range (list :start lsp-rocks--before-change-begin-pos :end lsp-rocks--before-change-end-pos)
                                   :rangeLength len
                                   :text (buffer-substring-no-properties begin end))))))

(defun lsp-rocks--will-save ()
  "Send textDocument/willSave notification."
  (lsp-rocks--request "textDocument/willSave"
                      ;; 1 Manual, 2 AfterDelay, 3 FocusOut
                      (append '(:reason 1) (lsp-rocks--TextDocumentIdentifier))))

(defun lsp-rocks--did-save ()
  "Send textDocument/didSave notification."
  (lsp-rocks--request "textDocument/didSave"
                      (lsp-rocks--TextDocumentIdentifier)
                      ;; (append `(:text ,(buffer-substring-no-properties (point-min) (point-max)))
                      ;;         )
                      ))

(defun lsp-rocks--completion ()
  (lsp-rocks--request "textDocument/completion"
                      (append `(:line ,(buffer-substring-no-properties (line-beginning-position) (line-end-position))
                                :column ,(current-column))
                              (lsp-rocks--TextDocumentPosition))))

(defun lsp-rocks--resolve (label)
  (lsp-rocks--request "completionItem/resolve"
                      (append (list :label label) (lsp-rocks--TextDocumentIdentifier))))

(defun lsp-rocks--sync-resolve (label)
  (lsp-rocks--sync "completionItem/resolve"
                   (append (list :label label) (lsp-rocks--TextDocumentIdentifier))))

(defun lsp-rocks--async-resolve (label)
  (when-let ((id (lsp-rocks--request-id)))
    (puthash "completionItem/resolve" id lsp-rocks--recent-requests)
    (lsp-rocks-call-async "resolve"
      (list :id id :cmd "completionItem/resolve" :params
        (append (list :label label) (lsp-rocks--TextDocumentIdentifier))))))

(defun lsp-rocks-find-definition ()
  "Find definition."
  (interactive)
  (lsp-rocks--request "textDocument/definition" (lsp-rocks--TextDocumentPosition)))

(defun lsp-rocks-find-type-definition ()
  "Find type definition."
  (interactive)
  (lsp-rocks--request "textDocument/typeDefinition" (lsp-rocks--TextDocumentPosition)))

(defun lsp-rocks-find-declaration ()
  "Find declaration."
  (interactive)
  (lsp-rocks--request "textDocument/declaration" (lsp-rocks--TextDocumentPosition)))

;; (list :includeDeclaration t)
(defun lsp-rocks-find-references ()
  "Find references."
  (interactive)
  (lsp-rocks--request "textDocument/references" (lsp-rocks--TextDocumentPosition)))

(defun lsp-rocks-find-implementations ()
  "Find implementations."
  (interactive)
  (lsp-rocks--request "textDocument/implementation" (lsp-rocks--TextDocumentPosition)))

(defun lsp-rocks-describe-thing-at-point ()
  "Display the type signature and documentation of the thing at point."
  (interactive)
  (lsp-rocks--request "textDocument/hover" (lsp-rocks--TextDocumentPosition)))

(defun lsp-rocks--signature-help (isRetrigger kind triggerCharacter)
  "Send signatureHelp request with params."
  ;; (lsp-rocks--request "textDocument/signatureHelp"
  ;;                     (list :textDocument
  ;;                           (list :uri buffer-file-name)
  ;;                           :position
  ;;                           (lsp-rocks--position)
  ;;                           :context
  ;;                           (list :triggerKind kind
  ;;                                 :triggerCharacter triggerCharacter
  ;;                                 :isRetrigger isRetrigger)))
  )

(defun lsp-rocks-restart-ts-ls ()
  "Restart ts-ls server."
  (interactive)
  (message "[LSP ROCKS] restarting...")
  (deferred:$
   (lsp-rocks-call-async "restart" (lsp-rocks--suggest-project-root))
   (deferred:nextc it
                   (lambda ()
                     (message "[LSP ROCKS] restart successed.")))))

(defun lsp-rocks-signature-help ()
  "Display the type signature and documentation of the thing at point."
  (interactive)
  (lsp-rocks--signature-help :false 1 nil))

(defun lsp-rocks--prepare-rename ()
  "Rename symbols."
  (lsp-rocks--request "textDocument/prepareRename" (lsp-rocks--TextDocumentPosition)))

(defcustom lsp-rocks-trim-trailing-whitespace t
  "Trim trailing whitespace on a line."
  :group 'lsp-rocks
  :type 'boolean)

(defcustom lsp-rocks-insert-final-newline t
  "Insert a newline character at the end of the file if one does not exist."
  :group 'lsp-rocks
  :type 'boolean)

(defcustom lsp-rocks-trim-final-newlines t
  "Trim all newlines after the final newline at the end of the file."
  :group 'lsp-rocks
  :type 'boolean)

(defvar lsp-rocks--formatting-indent-alist
  ;; Taken from `dtrt-indent-mode'
  '(
    (ada-mode                   . ada-indent)                       ; Ada
    (c++-mode                   . c-basic-offset)                   ; C++
    (c++-ts-mode                . c-ts-mode-indent-offset)
    (c-mode                     . c-basic-offset)                   ; C
    (c-ts-mode                  . c-ts-mode-indent-offset)
    (cperl-mode                 . cperl-indent-level)               ; Perl
    (crystal-mode               . crystal-indent-level)             ; Crystal (Ruby)
    (csharp-mode                . c-basic-offset)                   ; C#
    (csharp-tree-sitter-mode    . csharp-tree-sitter-indent-offset) ; C#
    (csharp-ts-mode             . csharp-ts-mode-indent-offset)     ; C# (tree-sitter, Emacs29)
    (css-mode                   . css-indent-offset)                ; CSS
    (d-mode                     . c-basic-offset)                   ; D
    (enh-ruby-mode              . enh-ruby-indent-level)            ; Ruby
    (erlang-mode                . erlang-indent-level)              ; Erlang
    (ess-mode                   . ess-indent-offset)                ; ESS (R)
    (go-ts-mode                 . go-ts-mode-indent-offset)
    (hack-mode                  . hack-indent-offset)               ; Hack
    (java-mode                  . c-basic-offset)                   ; Java
    (java-ts-mode               . java-ts-mode-indent-offset)
    (jde-mode                   . c-basic-offset)                   ; Java (JDE)
    (js-mode                    . js-indent-level)                  ; JavaScript
    (js2-mode                   . js2-basic-offset)                 ; JavaScript-IDE
    (js3-mode                   . js3-indent-level)                 ; JavaScript-IDE
    (json-mode                  . js-indent-level)                  ; JSON
    (json-ts-mode               . json-ts-mode-indent-offset)
    (lua-mode                   . lua-indent-level)                 ; Lua
    (nxml-mode                  . nxml-child-indent)                ; XML
    (objc-mode                  . c-basic-offset)                   ; Objective C
    (pascal-mode                . pascal-indent-level)              ; Pascal
    (perl-mode                  . perl-indent-level)                ; Perl
    (php-mode                   . c-basic-offset)                   ; PHP
    (powershell-mode            . powershell-indent)                ; PowerShell
    (raku-mode                  . raku-indent-offset)               ; Perl6/Raku
    (ruby-mode                  . ruby-indent-level)                ; Ruby
    (rust-mode                  . rust-indent-offset)               ; Rust
    (rust-ts-mode               . rust-ts-mode-indent-offset)
    (rustic-mode                . rustic-indent-offset)             ; Rust
    (scala-mode                 . scala-indent:step)                ; Scala
    (sgml-mode                  . sgml-basic-offset)                ; SGML
    (sh-mode                    . sh-basic-offset)                  ; Shell Script
    (toml-ts-mode               . toml-ts-mode-indent-offset)
    (typescript-mode            . typescript-indent-level)          ; Typescript
    (typescript-ts-mode         . typescript-ts-mode-indent-offset) ; Typescript (tree-sitter, Emacs29)
    (yaml-mode                  . yaml-indent-offset)               ; YAML

    (default                    . standard-indent))                 ; default fallback
  "A mapping from `major-mode' to its indent variable.")

(defun lsp-rocks--get-indent-width (mode)
  "Get indentation offset for MODE."
  (or (alist-get mode lsp-rocks--formatting-indent-alist)
      (lsp-rocks--get-indent-width (or (get mode 'derived-mode-parent) 'default))))

(defun lsp-rocks-format-buffer ()
  "Ask the server to format this document."
  (interactive)
  ;; (deferred:$
  (lsp-rocks--request "textDocument/formatting"
                      (append (list
                               :options
                               (list
                                :tabSize (symbol-value (lsp-rocks--get-indent-width major-mode))
                                :insertSpaces (not indent-tabs-mode)
                                :trimTrailingWhitespace lsp-rocks-trim-trailing-whitespace
                                :insertFinalNewline lsp-rocks-insert-final-newline
                                :trimFinalNewlinesmm lsp-rocks-trim-final-newlines))
                              (lsp-rocks--TextDocumentIdentifier)))
  ;; (deferred:nextc it
  ;;                 (lambda (text-edits)
  ;;                   (message "textEdits %s" text-edits)))
  ;; )
  )

(defun lsp-rocks--process-formatting (edits)
  "Invoke by LSP Rocks to format the buffer of DATA."
  (if (and edits (> (length edits) 0))
      (lsp-rocks--apply-text-edits edits)
    (error "[LSP ROCKS] No formatting changes provided %s" edits)))

;;;;;;;; sync request
(defun lsp-rocks--doc-buffer (item)
  "Get ITEM doc."
  (unless (get-text-property 0 'resolved-item item)
    (let* ((completion-item (get-text-property 0 'lsp-rocks--item item))
           (resolved-item (lsp-rocks--sync-resolve (plist-get completion-item :no)))) ;; (read item) 去掉了属性？
      (put-text-property 0 (length item) 'resolved-item resolved-item item)))
  (when-let* ((resolved-item (get-text-property 0 'resolved-item item))
              (documentation (plist-get resolved-item :documentation))
              (formatted (lsp-rocks--format-markup documentation)))
    (with-current-buffer (get-buffer-create "*lsp-rocks-doc*")
      (erase-buffer)
      (insert formatted)
      (current-buffer))))

(defvar-local lsp-rocks--prepare-result nil
  "Result of `lsp-rocks--prepare-rename'.")

(defcustom lsp-rocks-rename-use-prepare t
  "Whether `lsp-rocks-rename' should do a prepareRename first.
For some language servers, textDocument/prepareRename might be
too slow, in which case this variable may be set to nil.
`lsp-rocks-rename' will then use `thing-at-point' `symbol' to determine
the symbol to rename at point."
  :group 'lsp-rocks-mode
  :type 'boolean)

(defface lsp-rocks-face-rename '((t :underline t))
  "Face used to highlight the identifier being renamed.
Renaming can be done using `lsp-rocks-rename'."
  :group 'lsp-rocks-mode)

(defface lsp-rocks-rename-placeholder-face '((t :inherit font-lock-variable-name-face))
  "Face used to display the rename placeholder in.
When calling `lsp-rocks-rename' interactively, this will be the face of
the new name."
  :group 'lsp-rocks-mode)

(defvar lsp-rocks-rename-history '()
  "History for `lsp-rocks--read-rename'.")

(defun lsp-rocks--read-rename (at-point)
  "Read a new name for a `lsp-rocks-rename' at `point' from the user.

Returns a string, which should be the new name for the identifier
at point. If renaming cannot be done at point (as determined from
AT-POINT), throw a `user-error'.

This function is for use in `lsp-rocks-rename' only, and shall not be
relied upon."
  (unless at-point
    (user-error "`lsp-rocks-rename' is invalid here"))

  (let* ((start (caar at-point))
         (end (cdar at-point))
         (placeholder? (cdr at-point))
         (rename-me (buffer-substring start end))
         (placeholder (or placeholder? rename-me))
         (placeholder (propertize placeholder 'face 'lsp-rocks-rename-placeholder-face))
         overlay)

    ;; We need unwind protect, as the user might cancel here, causing the
    ;; overlay to linger.
    (unwind-protect
        (progn
          (setq overlay (make-overlay start end))
          (overlay-put overlay 'face 'lsp-rocks-face-rename)

          (read-string (format "Rename %s to: " rename-me) placeholder
                       'lsp-rocks-rename-history))
      (and overlay (delete-overlay overlay)))))

(defun lsp-rocks--rename-advice ()
  (when lsp-rocks-rename-use-prepare
    (lsp-rocks--prepare-rename)))
(advice-add 'lsp-rocks-rename :before #'lsp-rocks--rename-advice)

(defun lsp-rocks-rename ()
  "Rename symbols."
  (interactive)
  (let ((newName (lsp-rocks--read-rename
                  (or lsp-rocks--prepare-result
                      (when-let ((bounds (bounds-of-thing-at-point 'symbol)))
                        (cons bounds nil))))))
    (lsp-rocks--request "textDocument/rename"
                        (append `(:newName ,newName) (lsp-rocks--TextDocumentPosition)))))

(defun lsp-rocks--candidate-kind (item)
  "Return ITEM's kind."
  (let* ((completion-item (get-text-property 0 'lsp-rocks--item item))
         (kind (and completion-item (plist-get completion-item :kind)))
         (detail (and completion-item (plist-get completion-item :detail))))
    (concat
     (when detail
       (concat " " (s-replace "\r" "" detail)))
     (when-let ((kind-name (alist-get kind lsp-rocks--kind->symbol)))
       (format " (%s)" kind-name)))))

(defun lsp-rocks--make-candidate (item)
  "Convert a Completion ITEM to a string."
  (propertize (plist-get item :label) 'lsp-rocks--item item))

;; (defun lsp-rocks--lsp-position-to-point (pos-plist &optional marker)
;;   "Convert LSP position POS-PLIST to Emacs point.
;; If optional MARKER, return a marker instead"
;;   (save-excursion
;;     (save-restriction
;;       (widen)
;;       (goto-char (point-min))
;;       (forward-line (min most-positive-fixnum
;;                          (plist-get pos-plist :line)))
;;       (unless (eobp) ;; if line was excessive leave point at eob
;;         (let ((tab-width 1)
;;               (col (plist-get pos-plist :character)))
;;           (unless (wholenump col)
;;             (message
;;              "Caution: LSP server sent invalid character position %s. Using 0 instead."
;;              col)
;;             (setq col 0))
;;           (goto-char (min (+ (line-beginning-position) col)
;;                           (line-end-position)))))
;;       (if marker (copy-marker (point-marker)) (point)))))

;; TODO fix point if the line or charactor is -1
(defun lsp-rocks--range-region (range)
  "Return region (BEG . END) that represents LSP RANGE.
If optional MARKERS, make markers."
  (let ((beg (lsp-rocks--position-point (plist-get range :start)))
        (end (lsp-rocks--position-point (plist-get range :end))))
    (cons beg end)))

(defun lsp-rocks--to-yasnippet-snippet (snippet)
  "Convert LSP SNIPPET to yasnippet snippet."
  ;; LSP snippet doesn't escape "{" and "`", but yasnippet requires escaping it.
  (replace-regexp-in-string (rx (or bos (not (any "$" "\\"))) (group (or "{" "`")))
                            (rx "\\" (backref 1))
                            snippet
                            nil nil 1))

(defun lsp-rocks--snippet-expansion-fn (snippet &optional start end expand-env)
  "Compute a function to expand snippets.
Doubles as an indicator of snippet support."
  ;; (and (boundp 'yas-minor-mode)
  ;;      (symbol-value 'yas-minor-mode)
  ;;      'yas-expand-snippet)
  (let* ((inhibit-field-text-motion t)
         (yas-wrap-around-region nil)
         (yas-indent-line 'none)
         (yas-also-auto-indent-first-line nil))
    (yas-expand-snippet
     (lsp-rocks--to-yasnippet-snippet snippet)
     start end expand-env)))

(defun lsp-rocks--format-markup (markup)
  "Format MARKUP according to LSP's spec."
  (pcase-let ((`(,string ,mode)
               (if (stringp markup) (list markup 'gfm-view-mode)
                 (list (plist-get markup :value)
                       (pcase (plist-get markup :kind)
                         ("markdown" 'gfm-view-mode)
                         ("plaintext" 'text-mode)
                         (_ major-mode))))))
    (with-temp-buffer
      (setq-local markdown-fontify-code-blocks-natively t)
      (insert string)
      (let ((inhibit-message t)
            (message-log-max nil))
        (ignore-errors (delay-mode-hooks (funcall mode))))
      (font-lock-ensure)
      (string-trim (buffer-string)))))

(defun lsp-rocks--process-completion (data)
  "Process LSP completion DATA."
  (when lsp-rocks--company-callback
    (funcall
     lsp-rocks--company-callback
     (and data
          (mapcar (lambda (candidate)
                    (lsp-rocks--make-candidate candidate))
                  data)))))

(defun lsp-rocks--process-completion-resolve (item)
  "Process LSP resolved completion ITEM."
  (let ((candidate (nth company-selection company-candidates)))
    (put-text-property 0 1 'resolved-item item candidate)
    (when-let* ((document (plist-get item :documentation))
                (formatted-doc (lsp-rocks--format-markup document)))
      (with-current-buffer (get-buffer-create "*lsp-rocks-doc*")
        (erase-buffer)
        (insert formatted-doc)
        (lsp-rocks--markdown-render))
      (company--electric-do
        (setq other-window-scroll-buffer (get-buffer "*lsp-rocks-doc*"))
        (let ((win (display-buffer (get-buffer "*lsp-rocks-doc*") t)))
          (set-window-start win (point-min)))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; xref integration ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
(defun lsp-rocks--xref-backend () "lsp-rocks xref backend." 'xref-lsp-rocks)

(cl-defmethod xref-backend-identifier-at-point ((_backend (eql xref-lsp-rocks)))
  (propertize (or (thing-at-point 'symbol) "")
              'identifier-at-point t))

(cl-defmethod xref-backend-identifier-completion-table ((_backend (eql xref-lsp-rocks)))
  (list (propertize (or (thing-at-point 'symbol) "")
                    'identifier-at-point t)))

(cl-defmethod xref-backend-definitions ((_backend (eql xref-lsp-rocks)) identifier callback)
  (save-excursion
    (setq lsp-rocks--xref-callback callback)
    (lsp-rocks-find-definition)))

(cl-defmethod xref-backend-references ((_backend (eql xref-lsp-rocks)) identifier callback)
  (save-excursion
    (setq lsp-rocks--xref-callback callback)
    (lsp-rocks-find-references)))

(cl-defmethod xref-backend-implementations ((_backend (eql xref-lsp-rocks)) identifier callback)
  (save-excursion
    (setq lsp-rocks--xref-callback callback)
    (lsp-rocks-find-implementations)))

(cl-defmethod xref-backend-type-definitions ((_backend (eql xref-lsp-rocks)) identifier callback)
  (save-excursion
    (setq lsp-rocks--xref-callback callback)
    (lsp-rocks-find-type-definition)))

(defun lsp-rocks--process-find-definition (locations)
  ""
  (when (and locations lsp-rocks--xref-callback)
    (funcall lsp-rocks--xref-callback
             (cl-mapcar (lambda (it)
                          (let* ((filepath (plist-get it :uri))
                                 (range (plist-get it :range))
                                 (start (plist-get range :start))
                                 (end (plist-get range :end))
                                 (start-line (plist-get start :line))
                                 (start-column (plist-get start :character))
                                 (end-line (plist-get end :line))
                                 (end-column (plist-get end :character)))
                            (save-excursion
                              (save-restriction
                                (widen)
                                (let* ((beg (lsp-rocks--position-point start))
                                       (end (lsp-rocks--position-point end))
                                       (bol (progn (goto-char beg) (line-beginning-position)))
                                       (summary (buffer-substring bol (line-end-position)))
                                       (hi-beg (- beg bol))
                                       (hi-end (- (min (line-end-position) end) bol)))
                                  (when summary
                                    (add-face-text-property hi-beg hi-end 'xref-match t summary))
                                  (xref-make summary
                                             (xref-make-file-location filepath (1+ start-line) start-column)))))))
                        locations))))

(defface lsp-rocks-hover-posframe
  '((t :inherit tooltip))
  "Background and foreground for `lsp-rocks-hover-posframe'."
  :group 'lsp-mode)

(defcustom lsp-rocks-hover-buffer " *lsp-rocks-help*"
  "Buffer for display hover info."
  :type 'string
  :group 'lsp-rocks)

(defcustom lsp-rocks-signature-buffer " *lsp-rocks-signature*"
  "Buffer for display signature help info."
  :type 'string
  :group 'lsp-rocks)

(defun lsp-rocks--markdown-render ()
  (when (fboundp 'gfm-view-mode)
    (let ((inhibit-message t))
      (setq-local markdown-fontify-code-blocks-natively t)
      (set-face-background 'markdown-code-face (face-attribute 'lsp-rocks-hover-posframe :background nil t))
      (set-face-attribute 'markdown-code-face nil :height 130)
      (gfm-view-mode)))
  (read-only-mode 0)
  (prettify-symbols-mode 1)
  (display-line-numbers-mode -1)
  (font-lock-ensure)

  (setq-local mode-line-format nil))

(defun lsp-rocks--process-hover (hover-help)
  "Use posframe to show the HOVER-HELP string."
  (with-current-buffer (get-buffer-create lsp-rocks-hover-buffer)
    (erase-buffer)
    (insert hover-help)
    (lsp-rocks--markdown-render))

  (when (posframe-workable-p)
    (posframe-show lsp-rocks-hover-buffer
                   :max-width 60
                   :position (point)
                   :accept-focus nil
                   :lines-truncate t
                   :vertical-scroll-bars t
                   :internal-border-width 10
                   :poshandler #'posframe-poshandler-point-bottom-left-corner-upward
                   :background-color (face-attribute 'lsp-rocks-hover-posframe :background nil t)
                   :foreground-color (face-attribute 'lsp-rocks-hover-posframe :foreground nil t))))

(defun lsp-rocks--process-signature-help (signature-help)
  "Use posframe to show the SIGNATURE-HELP string."
  (let* ((signatures (plist-get signature-help :signatures))
         (activeSignature (plist-get signature-help :activeSignature))
         (info (mapcar (lambda (it)
                         (let ((label (plist-get it :label))
                               (doc (plist-get it :documentation)))
                           (if doc
                               (format "%s\n___\n%s" label doc)
                             label)))
                       signatures)))
    (with-current-buffer (get-buffer-create lsp-rocks-signature-buffer)
      (erase-buffer)
      (insert (nth activeSignature info))
      (lsp-rocks--markdown-render))

    (when (posframe-workable-p)
      (posframe-show lsp-rocks-signature-buffer
                     :max-width 60
                     :max-height 20
                     :lines-truncate t
                     :horizontal-scroll-bars t
                     :vertical-scroll-bars t
                     :position (point)
                     :accept-focus nil
                     :internal-border-width 10
                     :poshandler #'posframe-poshandler-point-bottom-left-corner-upward
                     :background-color (face-attribute 'lsp-rocks-hover-posframe :background nil t)
                     :foreground-color (face-attribute 'lsp-rocks-hover-posframe :foreground nil t)))))

(defun lsp-rocks--process-prepare-rename (data)
  (let* ((range (plist-get data :range))
         (start (plist-get range :start))
         (end (plist-get range :end))
         (placeholder (plist-get data :placeholder))
         (start-point (lsp-rocks--lsp-position-to-point start))
         (end-point (lsp-rocks--lsp-position-to-point end)))
    (setq-local lsp-rocks--prepare-result
                (cons (cons start-point end-point)
                      (if (string-empty-p placeholder) nil placeholder)))
    (with-current-buffer (current-buffer)
      (require 'pulse)
      (let ((pulse-iterations 1)
            (pulse-delay lsp-rocks-flash-line-delay))
        (pulse-momentary-highlight-region start-point end-point 'lsp-rocks-font-lock-flash)))))

(defun lsp-rocks--uri-to-path (uri)
  "Convert URI to file path."
  (when (keywordp uri) (setq uri (substring (symbol-name uri) 1)))
  (let* ((retval (url-unhex-string (url-filename (url-generic-parse-url uri))))
         ;; Remove the leading "/" for local MS Windows-style paths.
         (normalized (if (and (eq system-type 'windows-nt)
                              (cl-plusp (length retval)))
                         (substring retval 1)
                       retval)))
    normalized))

(defun lsp-rocks--process-rename (data)
  (when lsp-rocks--prepare-result
    (setq-local lsp-rocks--prepare-result nil))

  (let ((changes (plist-get data :documentChanges)))
    (dolist (item changes)
      (let* ((textDocument (plist-get item :textDocument))
             (filepath (lsp-rocks--uri-to-path (plist-get textDocument :uri)))
             (edits (plist-get item :edits)))
        (find-file-noselect filepath)
        (save-excursion
          (find-file filepath)
          (dolist (edit edits)
            (let ((region (lsp-rocks--range-region (plist-get edit :range)))
                  (newText (plist-get edit :newText)))
              (delete-region (car region) (cdr region))
              (goto-char (car region))
              (insert newText))))))))

(defun lsp-rocks--TextDocumentIdentifier ()
  "Make a TextDocumentIdentifier object."
  `(:textDocument
    (:uri ,(buffer-file-name))))

(defun lsp-rocks--TextDocumentPosition ()
  "Make a TextDocumentPosition object."
  (append `(:position ,(lsp-rocks--position))
          (lsp-rocks--TextDocumentIdentifier)))

(defun lsp-rocks--json-parse (json)
  "Parse JSON data to `plist'."
  (json-parse-string json :object-type 'plist :array-type 'list))

(defun lsp-rocks--json-stringify (object)
  "Stringify OBJECT data to JSON."
  (json-serialize object :null-object nil))

(defun lsp-rocks--request (cmd &optional params)
  "Send a message with given CMD and PARAMS."
  (when-let ((id (lsp-rocks--request-id)))
    (puthash cmd id lsp-rocks--recent-requests)
    (lsp-rocks-call-async "message" (list :id id :cmd cmd :params params))))

(defun lsp-rocks--sync (cmd &optional params)
  "Send a message with given CMD and PARAMS synchronously."
  (when-let ((id (lsp-rocks--request-id)))
    (puthash cmd id lsp-rocks--recent-requests)
    (lsp-rocks-call-sync "request" (list :id id :cmd cmd :params params))))

(defun lsp-rocks--response (id cmd data)
  "Send response to server."
  (lsp-rocks-call-async "message" (list :id id :cmd cmd :data data)))

(defun lsp-rocks--point-position (pos)
  "Get position of POS."
  (lsp-rocks--save-restriction-and-excursion
    (goto-char pos)
    (lsp-rocks--position)))

(defun lsp-rocks--line-character-to-point (line character)
  "Return the point for character CHARACTER on line LINE."
  (let ((inhibit-field-text-motion t))
    (lsp-rocks--save-restriction-and-excursion
      (goto-char (point-min))
      (forward-line line)
      ;; server may send character position beyond the current line and we
      ;; sould fallback to line end.
      (let* ((line-end (line-end-position)))
        (if (> character (- line-end (point)))
            line-end
          (forward-char character)
          (point))))))

(defun lsp-rocks--position-point (pos)
  "Convert `Position' object POS to a point."
  (let* ((line (plist-get pos :line))
         (character (plist-get pos :character)))
    (lsp-rocks--line-character-to-point line character)))

(defun lsp-rocks--position-equal (pos-a pos-b)
  "Return whether POS-A and POS-B positions are equal."
  (and (= (plist-get pos-a :line) (plist-get pos-b :line))
       (= (plist-get pos-a :character) (plist-get pos-b :character))))

(defun lsp-rocks--position-compare (pos-a pos-b)
  "Return t if POS-A if greater thatn POS-B."
  (let* ((line-a (plist-get pos-a :line))
         (line-b (plist-get pos-b :line)))
    (if (= line-a line-b)
        (> (plist-get pos-a :character) (plist-get pos-b :character))
      (> line-a line-b))))

(defun lsp-rocks--calculate-column ()
  "Calculate character offset of cursor in current line."
  (/ (- (length
         (encode-coding-region
          (line-beginning-position)
          (min (point) (point-max)) 'utf-16 t))
        2)
     2))

(defun lsp-rocks--position ()
  (list :line (1- (line-number-at-pos)) :character (lsp-rocks--calculate-column)))

(defun lsp-rocks--request-id ()
  (lsp-rocks--random-string 8))

(defun lsp-rocks--random-alnum ()
  (let* ((alnum "abcdefghijklmnopqrstuvwxyz0123456789")
         (i (% (abs (random)) (length alnum))))
    (substring alnum i (1+ i))))

(defun lsp-rocks--random-string (n)
  "Generate a slug of n random alphanumeric characters."
  (if (= 0 n) ""
    (concat (lsp-rocks--random-alnum) (lsp-rocks--random-string (1- n)))))

(defun lsp-rocks--before-change (begin end)
  (setq-local lsp-rocks--before-change-begin-pos (lsp-rocks--point-position begin))
  (setq-local lsp-rocks--before-change-end-pos (lsp-rocks--point-position end)))

(defun lsp-rocks--after-change (begin end len)
  (save-match-data
    (let ((inhibit-quit t))
      (when (not revert-buffer-in-progress-p)
        (setq lsp-rocks--current-file-version (1+ lsp-rocks--current-file-version))
        (lsp-rocks--did-change begin end len)
        (lsp-rocks--signature-help t 3 nil)))))

(defun lsp-rocks--before-revert-hook ()
  (lsp-rocks--did-close))

(defun lsp-rocks--after-revert-hook ()
  (lsp-rocks--did-open))

(defun lsp-rocks--before-save-hook ()
  (lsp-rocks--will-save))

(defun lsp-rocks--after-save-hook ()
  (lsp-rocks--did-save))

(defun lsp-rocks--kill-buffer-hook ()
  (lsp-rocks-mode -1)
  (lsp-rocks--did-close))

(defvar lsp-rocks--on-idle-timer nil)

(defcustom lsp-rocks-idle-delay 0.500
  "Debounce interval for `after-change-functions'."
  :type 'number
  :group 'lsp-rocks)

(defcustom lsp-rocks-on-idle-hook nil
  "Hooks to run after `lsp-rocks-idle-delay'."
  :type 'hook
  :group 'lsp-rocks)

(defun lsp-rocks--idle-reschedule (buffer)
  "LSP rocks idle schedule on current BUFFER."
  (when lsp-rocks--on-idle-timer
    (cancel-timer lsp-rocks--on-idle-timer))
  (setq lsp-rocks--on-idle-timer (run-with-idle-timer
                                  lsp-rocks-idle-delay
                                  nil
                                  #'lsp-rocks--on-idle
                                  buffer)))
(defun lsp-rocks--on-idle (buffer)
  "Start post command loop on current BUFFER."
  (when (and (buffer-live-p buffer)
             (equal buffer (current-buffer))
             lsp-rocks-mode)
    (run-hooks 'lsp-rocks-on-idle-hook)))

(defun lsp-rocks--post-command-hook ()
  "Post command hook."
  (lsp-rocks--idle-reschedule (current-buffer))
  (let ((this-command-string (format "%s" this-command)))

    (unless (member this-command-string '("self-insert-command" "company-complete-selection" "yas-next-field-or-maybe-expand"))
      (posframe-hide lsp-rocks-signature-buffer))

    (when lsp-rocks-mode
      (posframe-hide lsp-rocks-hover-buffer))

    (when (and lsp-rocks-mode
               (or (string-equal this-command-string "company-complete-selection")
                   (string-equal this-command-string "yas-next-field-or-maybe-expand")))
      (lsp-rocks--signature-help t 3 nil))))

(defconst lsp-rocks--internal-hooks
  '((before-change-functions . lsp-rocks--before-change)
    (after-change-functions . lsp-rocks--after-change)
    (before-revert-hook . lsp-rocks--before-revert-hook)
    (after-revert-hook . lsp-rocks--after-revert-hook)
    (kill-buffer-hook . lsp-rocks--kill-buffer-hook)
    (xref-backend-functions . lsp-rocks--xref-backend)
    (before-save-hook . lsp-rocks--before-save-hook)
    (after-save-hook . lsp-rocks--after-save-hook)
    (post-command-hook . lsp-rocks--post-command-hook)))

(defun lsp-rocks-register-internal-hooks ()
  "Register internal hooks."
  (dolist (hook lsp-rocks--internal-hooks)
    (add-hook (car hook) (cdr hook) nil t))
  (lsp-rocks-diagnostics-flycheck-enable))

(defun lsp-rocks-diagnostics--flycheck-start (checker callback)
  "Start an LSP syntax check with CHECKER.
CALLBACK is the status callback passed by Flycheck."
  (deferred:$
   (lsp-rocks-call-async "pullDiagnostics" (buffer-file-name))
   (deferred:nextc it
                   (lambda (diagnostics)
                     (if diagnostics
                         (progn
                           (let ((errors (mapcar
                                          (lambda (diagnostic)
                                            (let* ((range (plist-get diagnostic :range))
                                                   (start (plist-get range :start))
                                                   (end (plist-get range :end)))
                                              (flycheck-error-new
                                               :buffer (current-buffer)
                                               :checker checker
                                               :filename (buffer-file-name)
                                               :message (plist-get diagnostic :message)
                                               :level (pcase (plist-get diagnostic :severity)
                                                        (1 'error)
                                                        (2 'warning)
                                                        (3 'info)
                                                        (4 'info)
                                                        (_ 'error))
                                               :id (plist-get diagnostic :code)
                                               :group (plist-get diagnostic :source)
                                               :line (1+ (plist-get start :line))
                                               :column (1+ (plist-get start :character))
                                               :end-line (1+ (plist-get end :line))
                                               :end-column (1+ (plist-get end :character)))))
                                          diagnostics)))
                             (funcall callback 'finished errors)))
                       (funcall callback 'finished '())))))
  ;; (if-let ((diagnostics (lsp-rocks-call-sync "pullDiagnostics" (buffer-file-name))))
  ;;     (progn
  ;;       (let ((errors (mapcar
  ;;                      (lambda (diagnostic)
  ;;                        (let* ((range (plist-get diagnostic :range))
  ;;                               (start (plist-get range :start))
  ;;                               (end (plist-get range :end)))
  ;;                          (flycheck-error-new
  ;;                           :buffer (current-buffer)
  ;;                           :checker checker
  ;;                           :filename (buffer-file-name)
  ;;                           :message (plist-get diagnostic :message)
  ;;                           :level (pcase (plist-get diagnostic :severity)
  ;;                                    (1 'error)
  ;;                                    (2 'warning)
  ;;                                    (3 'info)
  ;;                                    (4 'info)
  ;;                                    (_ 'error))
  ;;                           :id (plist-get diagnostic :code)
  ;;                           :group (plist-get diagnostic :source)
  ;;                           :line (1+ (plist-get start :line))
  ;;                           :column (1+ (plist-get start :character))
  ;;                           :end-line (1+ (plist-get end :line))
  ;;                           :end-column (1+ (plist-get end :character)))))
  ;;                      diagnostics)))
  ;;         (funcall callback 'finished errors)))
  ;;   (funcall callback 'finished '()))
  )

(defun lsp-rocks--diagnostics-flycheck-report ()
  "Report flycheck.
This is invoked by lsp-rocks."
  (with-current-buffer (current-buffer)
    (add-hook 'lsp-rocks-on-idle-hook #'lsp-rocks-diagnostics--flycheck-buffer)
    (lsp-rocks--idle-reschedule (current-buffer))))

(defun lsp-rocks-diagnostics--flycheck-buffer ()
  "Trigger flycheck on buffer."
  (remove-hook 'lsp-rocks-on-idle-hook #'lsp-rocks-diagnostics--flycheck-start t)
  (when (bound-and-true-p flycheck-mode)
    (flycheck-buffer)))

(flycheck-define-generic-checker 'lsp-rocks
  "A syntax checker using the langauge server protocol provided by lsp-rocks."
  :start #'lsp-rocks-diagnostics--flycheck-start
  :modes '(lsp-rocks-placeholder-mode)
  :predicate (lambda () lsp-rocks-mode))

(defun lsp-rocks-diagnostics-flycheck-enable (&rest _)
  "Enable flycheck integration for the current buffer."
  ;; (and (not lsp-rocks-diagnostics--flycheck-enabled)
  ;;      (not (eq flycheck-checker 'lsp-rocks))
  ;;      (setq lsp-rocks-diagnostics--flycheck-checker flycheck-checker))
  (unless lsp-rocks-diagnostics--flycheck-enabled
    (setq-local lsp-rocks-diagnostics--flycheck-enabled t)
    (add-to-list 'flycheck-checkers 'lsp-rocks)
    (unless (flycheck-checker-supports-major-mode-p 'lsp-rocks major-mode)
      (flycheck-add-mode 'lsp-rocks major-mode)))
  (flycheck-mode 1)
  ;; (flycheck-stop)
  ;; (setq-local flycheck-checker 'lsp-rocks)
  ;; (make-local-variable 'flycheck-checkers)
  ;; (flycheck-add-next-checker lsp-rocks-diagnostics--flycheck-checker 'lsp-rocks)
  )

(defun lsp-rocks-diagnostics-flycheck-disable (&rest _)
  "Disable flycheck integartion for the current buffer."
  (when lsp-rocks-diagnostics--flycheck-enabled
    ;; (flycheck-stop)
    ;; (when (eq flycheck-checker 'lsp-rocks)
    ;;   (setq-local flychecker-checker lsp-rocks-diagnostics--flycheck-checker))
    ;; (setq lsp-rocks-diagnostics--flycheck-checker nil)
    (setq-local lsp-rocks-diagnostics--flycheck-enabled nil)
    ;; (when flycheck-mode
    ;;   (flycheck-mode 1))
    ))

(defun lsp-rocks--on-set-visited-file-name (old-func &rest args)
  "Advice around function `set-visited-file-name'.

This advice sends textDocument/didClose for the old file and
textDocument/didOpen for the new file."
  (when lsp-rocks-mode
    (lsp-rocks--did-close))
  (prog1 (apply old-func args)
    (when lsp-rocks-mode
      (lsp-rocks--did-open))))

(advice-add 'set-visited-file-name :around #'lsp-rocks--on-set-visited-file-name)

(defun lsp-rocks--enable ()
  (when buffer-file-name
    (if (epc:live-p lsp-rocks-process)
        (progn
          (setq-local lsp-rocks--completion-trigger-characters nil)
          (lsp-rocks-register-internal-hooks)
          (lsp-rocks--did-open)
          )
      (lsp-rocks-start-process))
    ))

(defun lsp-rocks--disable ()
  (dolist (hook lsp-rocks--internal-hooks)
    (remove-hook (car hook) (cdr hook) t))
  ;; (remove-hook 'lsp-rocks-started-hook 'lsp-rocks-register-internal-hooks)
  (lsp-rocks-diagnostics-flycheck-disable))

(defvar lsp-rocks-mode-map (make-sparse-keymap))

;;;###autoload
(define-minor-mode lsp-rocks-mode
  "LSP Rocks mode."
  :init-value nil
  :lighter " LSP/R"
  :keymap lsp-rocks-mode-map
  (if lsp-rocks-mode
      (lsp-rocks--enable)
    (lsp-rocks--disable)))

(provide 'lsp-rocks)

;;; lsp-rocks.el ends here
