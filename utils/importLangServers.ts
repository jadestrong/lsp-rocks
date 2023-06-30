import { readdir } from "fs"
import { join } from "path";

function importLangServers(directoryPath: string) {
  return new Promise((resolve, reject) => {
    readdir(directoryPath, (err, files) => {
      if (err) {
        reject(err);
        return;
      }

      files.forEach(file => {
        if (file.endsWith('.ts')) {
          const filePath = join(directoryPath, file);
          require(filePath)
        }
      })
    })
  })
}
