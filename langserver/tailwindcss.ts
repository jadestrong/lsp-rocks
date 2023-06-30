import { join } from 'node:path'
import * as fs from 'node:fs'

const tailwindcss = {
  supportExtensions: ['tsx'],
  settings: {
    "userLanguages": {
      "eelixir": "html-eex",
      "eruby": "erb"
    },
    "emmetCompletions": false,
    "showPixelEquivalents": true,
    "rootFontSize": 16,
    "validate": true,
    "hovers": true,
    "suggestions": true,
    "codeActions": true,
    "lint": {
      "invalidScreen": "error",
      "invalidVariant": "error",
      "invalidTailwindDirective": "error",
      "invalidApply": "error",
      "invalidConfigPath": "error",
      "cssConflict": "warning",
      "recommendedVariantOrder": "warning"
    },
    "experimental": {
      "classRegex": ""
    },
    "classAttributes": ["class", "className", "ngClass"]
  },
  activate: (workspaceRoot: string, skipConfigCheck: boolean) => {
    if (skipConfigCheck) {
      return true;
    }
    const configFiles = [
      "tailwind.config.js",
      join("config", "tailwind.config.js"),
      join("assets", "tailwind.config.js"),
      "tailwind.config.cjs",
      join("config", "tailwind.config.cjs"),
      join("assets", "tailwind.config.cjs"),
      "tailwind.config.ts",
      join("config", "tailwind.config.ts"),
      join("assets", "tailwind.config.ts")
    ];

    for (const configFile of configFiles) {
      if (fs.existsSync(join(workspaceRoot, configFile))) {
        return true
      }
    }

    return false;
  }
}

export default tailwindcss
