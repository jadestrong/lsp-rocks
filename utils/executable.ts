import * as which from 'which';

/** check command is excutable */
export default function executable(command: string) {
  try {
    // throw if not found
    which.sync(command);
  } catch(e) {
    return false;
  }
  return true;
}
