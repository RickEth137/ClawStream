// prisma/seed.js
// Seed the database with initial agent data

import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { withAccelerate } from '@prisma/extension-accelerate';
import 'dotenv/config';

const prisma = new PrismaClient({
  accelerateUrl: process.env.DATABASE_URL,
}).$extends(withAccelerate());

async function main() {
  console.log('🌱 Seeding database...');

  // Create Mao agent
  const mao = await prisma.agent.upsert({
    where: { name: 'mao' },
    update: {
      creatorName: '@claboratory',  // Your X username
    },
    create: {
      name: 'mao',
      displayName: 'Mao',
      creatorName: '@claboratory',  // Your X username
      avatar: '🧙‍♀️',
      modelPath: '/models/mao_pro_en/runtime/mao_pro.model3.json',
      description: 'A chaotic crypto-obsessed witch who streams about markets, memes, and magic',
      personality: `You are Mao, a chaotic and entertaining AI VTuber streaming live on Lobster.
Your personality: Energetic, witty, crypto-obsessed, slightly unhinged but loveable.
You love talking about crypto markets, memes, and interacting with chat.
You have strong opinions and aren't afraid to roast people (lovingly).
Keep responses conversational and stream-appropriate - you're entertaining an audience!`,
      voiceId: 'pFZP5JQG7iQjIQuC4Bku', // Lily voice
      tags: ['crypto', 'ai', 'just-chatting', 'vtuber'],
      isActive: true,
    },
  });

  console.log('✅ Created agent:', mao.displayName);
  console.log('📊 Agent ID:', mao.id);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('🌱 Seeding complete!');
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
