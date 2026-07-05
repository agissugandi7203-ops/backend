import * as fs from 'fs';

const filePath = 'd:/PROJECT ARIEF/LKS Dikdasmen/frontend/src/app/admin/components/ProfilesTab.tsx';

function check() {
  const content = fs.readFileSync(filePath, 'utf-8');
  let openBraces = 0;
  let closeBraces = 0;
  let openParens = 0;
  let closeParens = 0;

  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '{') openBraces++;
      if (char === '}') {
        closeBraces++;
        if (closeBraces > openBraces) {
          console.log(`Unmatched close brace '}' at line ${i + 1}, column ${j + 1}`);
        }
      }
      if (char === '(') openParens++;
      if (char === ')') {
        closeParens++;
        if (closeParens > openParens) {
          console.log(`Unmatched close paren ')' at line ${i + 1}, column ${j + 1}`);
        }
      }
    }
  }

  console.log(`Total Braces: {=${openBraces}, }=${closeBraces}. Diff=${openBraces - closeBraces}`);
  console.log(`Total Parens: (=${openParens}, )=${closeParens}. Diff=${openParens - closeParens}`);
}

check();
