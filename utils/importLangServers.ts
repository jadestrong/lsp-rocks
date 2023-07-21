import { readdir } from 'fs';
import { join } from 'path';

const langServerPath = join(__dirname, '../langserver/');

export function importLangServers() {
  return new Promise<ServerConfig[]>((resolve, reject) => {
    readdir(langServerPath, async (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      const tasks = files
        .filter(file => file.endsWith('.ts'))
        .map(async file => {
          const filePath = join(langServerPath, file);
          const { default: config } = await import(filePath);
          return config;
        });

      const configs = await Promise.all(tasks);
      return resolve(configs);
    });
  });
}
