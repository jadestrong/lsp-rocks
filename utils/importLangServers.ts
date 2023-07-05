import { readdir } from "fs"
import { join } from "path";

const langServerPath = '../langserver/'

export function importLangServers() {
  return new Promise<Record<string, any>>((resolve, reject) => {
    readdir(langServerPath, async (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      const tasks = files
        .filter(file => file.endsWith('.ts'))
        .map(async (file) => {
          const filePath = join(langServerPath, file);
          const { default: config } = await import(filePath)
          return config;
        });

      const configs = await Promise.all(tasks);
      return resolve(configs.reduce((prev, cur) => {
        prev[cur.name] = cur;
        return prev;
      }, {}));
    })
  })
}
