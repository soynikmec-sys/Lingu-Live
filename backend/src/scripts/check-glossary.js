import fs from 'fs';
import path from 'path';

const glossaryPath = process.argv[2] || '../glossary.json';

try {
  const fullPath = path.resolve(process.cwd(), glossaryPath);
  const data = fs.readFileSync(fullPath, 'utf-8');
  const glossary = JSON.parse(data);
  
  console.log('✅ Glosario válido');
  console.log(`📚 ${Object.keys(glossary).length} términos encontrados`);
  console.log('');
  console.log('Ejemplos de términos:');
  Object.entries(glossary).slice(0, 5).forEach(([term, definition]) => {
    console.log(`  - ${term}: ${definition}`);
  });
  
  if (Object.keys(glossary).length > 5) {
    console.log(`  ... y ${Object.keys(glossary).length - 5} más`);
  }
} catch (error) {
  console.error('❌ Error leyendo glosario:', error.message);
  process.exit(1);
}
