// src/confetti.ts

const CONFETTI_VARIANTS = [
  '✨ 🎉 ✨  🎊  ✨ 🎉 ✨\n  🎈     🎊     🎈\n✨    🎉    ✨    🎉',
  '🎊 ✨ 🎈 ✨ 🎊\n  🎉   🎉   🎉\n✨ 🎈 ✨ 🎈 ✨',
  '🎉✨🎊✨🎉✨🎊✨🎉\n   🎈       🎈\n✨🎊✨🎉✨🎊✨🎉✨',
];

export function getConfetti(randomFn: () => number = Math.random): string {
  const index = Math.floor(randomFn() * CONFETTI_VARIANTS.length);
  return CONFETTI_VARIANTS[index];
}

export function printConfetti(randomFn: () => number = Math.random): void {
  console.log(`\n${getConfetti(randomFn)}\n`);
}
