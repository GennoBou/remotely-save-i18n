#!/usr/bin/env node
/**
 * i18n Validation Script for Obsidian Plugins (Zero-dependency ESM)
 * Checks:
 * 1. Missing keys in target locales vs base locale (en.json)
 * 2. Extraneous keys in target locales
 * 3. Placeholder consistency (e.g. {name}, {count}) between base and target
 * 4. Empty translations
 */

import fs from "node:fs";
import path from "node:path";

function extractPlaceholders(text) {
    if (typeof text !== "string") return [];
    // Matches Mustache style {{var}} or {{{var}}} and single brace {var} where var is an identifier
    const matches = text.match(/\{\{\{?[a-zA-Z0-9_]+\}?\}\}|\{[a-zA-Z0-9_]+\}/g) || [];
    return matches.map(m => m.trim()).sort();
}

function checkI18n(options) {
    const { localesDir, baseLocale, strict } = options;
    const baseFilePath = path.join(localesDir, `${baseLocale}.json`);

    if (!fs.existsSync(baseFilePath)) {
        console.error(`[ERROR] Base locale file not found: ${baseFilePath}`);
        return false;
    }

    let baseDict;
    try {
        baseDict = JSON.parse(fs.readFileSync(baseFilePath, "utf-8"));
    } catch (e) {
        console.error(`[ERROR] Failed to parse base locale JSON: ${baseFilePath}`, e);
        return false;
    }

    const baseKeys = Object.keys(baseDict);
    console.log(`[INFO] Validating: ${localesDir}`);
    console.log(`[INFO] Base locale (${baseLocale}) contains ${baseKeys.length} keys.`);

    const files = fs.readdirSync(localesDir);
    const targetFiles = files.filter(
        (f) => f.endsWith(".json") && f !== `${baseLocale}.json`
    );

    let hasErrors = false;
    let totalWarnings = 0;

    for (const file of targetFiles) {
        const targetLocale = path.basename(file, ".json");
        const targetFilePath = path.join(localesDir, file);
        console.log(`\n--- Checking [${targetLocale}] (${file}) ---`);

        let targetDict;
        try {
            targetDict = JSON.parse(fs.readFileSync(targetFilePath, "utf-8"));
        } catch (e) {
            console.error(`[ERROR] Failed to parse JSON: ${targetFilePath}`, e);
            hasErrors = true;
            continue;
        }

        const targetKeys = Object.keys(targetDict);

        // 1. Missing keys
        const missingKeys = baseKeys.filter((k) => !(k in targetDict));
        if (missingKeys.length > 0) {
            const isCriticalLocale = targetLocale === "ja";
            if (isCriticalLocale || strict) {
                console.error(`[FAIL] Missing ${missingKeys.length} keys in ${targetLocale}:`);
                missingKeys.slice(0, 10).forEach((k) => console.error(`  - "${k}"`));
                if (missingKeys.length > 10) {
                    console.error(`  ... and ${missingKeys.length - 10} more.`);
                }
                hasErrors = true;
            } else {
                console.warn(`[WARN] Missing ${missingKeys.length} keys in upstream community locale ${targetLocale}:`);
                missingKeys.slice(0, 5).forEach((k) => console.warn(`  - "${k}"`));
                totalWarnings += missingKeys.length;
            }
        } else {
            console.log(`[PASS] All ${baseKeys.length} base keys are present.`);
        }

        // 2. Extraneous keys
        const extraKeys = targetKeys.filter((k) => !(k in baseDict));
        if (extraKeys.length > 0) {
            console.warn(`[WARN] Found ${extraKeys.length} extraneous keys in ${targetLocale} (not in base):`);
            extraKeys.slice(0, 5).forEach((k) => console.warn(`  + "${k}"`));
            totalWarnings += extraKeys.length;
            if (strict) hasErrors = true;
        }

        // 3. Placeholder & Empty check
        let placeholderMismatchCount = 0;
        let emptyCount = 0;

        for (const key of baseKeys) {
            if (!(key in targetDict)) continue;

            const baseVal = baseDict[key] || key;
            const targetVal = targetDict[key];

            if (targetVal === "" || targetVal === undefined) {
                console.warn(`[WARN] Empty translation for key: "${key}"`);
                emptyCount++;
                totalWarnings++;
                if (strict) hasErrors = true;
                continue;
            }

            const basePlaceholders = extractPlaceholders(baseVal);
            const targetPlaceholders = extractPlaceholders(targetVal);

            if (basePlaceholders.join(",") !== targetPlaceholders.join(",")) {
                console.error(
                    `[FAIL] Placeholder mismatch for key "${key}":\n` +
                    `  Base:   "${baseVal}" -> [${basePlaceholders.join(", ")}]\n` +
                    `  Target: "${targetVal}" -> [${targetPlaceholders.join(", ")}]`
                );
                placeholderMismatchCount++;
                hasErrors = true;
            }
        }

        if (emptyCount > 0) {
            console.warn(`[WARN] Found ${emptyCount} empty translations in ${targetLocale}.`);
        }

        if (placeholderMismatchCount === 0) {
            console.log(`[PASS] All placeholders match base locale.`);
        }
    }

    return !hasErrors;
}

// CLI entrypoint
const isStrict = process.argv.includes("--strict");
const customDir = process.argv.find((arg) => !arg.startsWith("-") && arg !== process.argv[0] && arg !== process.argv[1]);

let targetDirs = [];
if (customDir) {
    targetDirs.push(path.resolve(customDir));
} else {
    const candidateDirs = [
        path.join(process.cwd(), "src", "langs"),
        path.join(process.cwd(), "pro", "src", "langs"),
        path.join(process.cwd(), "src", "locales"),
        path.join(process.cwd(), "locales"),
    ];
    for (const dir of candidateDirs) {
        if (fs.existsSync(dir) && fs.existsSync(path.join(dir, "en.json"))) {
            targetDirs.push(dir);
        }
    }
}

if (targetDirs.length === 0) {
    console.error("[ERROR] No valid localization directory found (e.g., src/langs, pro/src/langs, src/locales).");
    process.exit(1);
}

let allOk = true;
for (const dir of targetDirs) {
    const ok = checkI18n({
        localesDir: dir,
        baseLocale: "en",
        strict: isStrict,
    });
    if (!ok) allOk = false;
}

console.log("\n=================================");
if (!allOk) {
    console.error(`[RESULT] FAILED with errors.`);
    process.exit(1);
} else {
    console.log(`[RESULT] SUCCESS! All localization files validated.`);
    process.exit(0);
}
