const fs = require('fs');
const path = require('path');

function main() {
  const target = path.join(
    __dirname,
    '..',
    'node_modules',
    'app-builder-lib',
    'templates',
    'nsis',
    'installSection.nsh'
  );

  if (!fs.existsSync(target)) {
    console.warn(`[patch-nsis-details] Template not found: ${target}`);
    return;
  }

  const original = fs.readFileSync(target, 'utf8');
  let patched = original.replace(/SetDetailsPrint\s+none/g, 'SetDetailsPrint both');
  if (!patched.includes('DetailPrint "Extracting application files... (this may take a moment)"')) {
    patched = patched.replace(
      '!insertmacro installApplicationFiles',
      'DetailPrint "Extracting application files... (this may take a moment)"\n!insertmacro installApplicationFiles\nDetailPrint "Finished extracting application files."'
    );
  }

  if (patched !== original) {
    fs.writeFileSync(target, patched, 'utf8');
    console.log('[patch-nsis-details] Patched installSection.nsh to show details output.');
  } else {
    console.log('[patch-nsis-details] No changes needed (already patched).');
  }
}

main();
