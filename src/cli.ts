#!/usr/bin/env node

import { checkRestrictions } from './check-restrictions.js';

const gameJsPath = process.argv[2] || './game.js';

console.log('\n🎮 Platanus Hack 26: Checking game restrictions...\n');

checkRestrictions(gameJsPath)
  .then((checkResults) => {
    checkResults.results.forEach((result) => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.name}: ${result.message}`);
      if (result.details) {
        console.log(`   ${result.details}`);
      }
    });

    console.log(`\n${'='.repeat(50)}`);
    if (checkResults.passed) {
      console.log('🎉 All checks passed! Your game is ready for submission.');
    } else {
      console.log('⚠️  Some checks failed. Please fix the issues above.');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('❌ Error running checks:', error);
    process.exit(1);
  });
