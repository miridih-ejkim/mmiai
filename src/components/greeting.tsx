'use client';

import { motion } from 'motion/react';

export function Greeting() {
  return (
    <motion.div
      className="flex h-[50vh] flex-col items-center justify-center gap-2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <h2 className="text-2xl font-semibold tracking-tight">
        안녕하세요!
      </h2>
      <p className="text-muted-foreground">무엇을 도와드릴까요?</p>
    </motion.div>
  );
}
