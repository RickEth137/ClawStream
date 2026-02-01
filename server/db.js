// server/db.js
// Prisma client with Accelerate extension

import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { withAccelerate } from '@prisma/extension-accelerate';

const prisma = new PrismaClient({
  accelerateUrl: process.env.DATABASE_URL,
}).$extends(withAccelerate());

export default prisma;

// Helper functions for common operations

// ============ AGENTS ============

export async function getAgent(name) {
  return prisma.agent.findUnique({
    where: { name },
  });
}

export async function getAgentById(id) {
  return prisma.agent.findUnique({
    where: { id },
  });
}

export async function getAllAgents() {
  return prisma.agent.findMany({
    where: { isActive: true },
    orderBy: { followers: 'desc' },
  });
}

export async function createAgent(data) {
  return prisma.agent.create({
    data,
  });
}

export async function updateAgent(name, data) {
  return prisma.agent.update({
    where: { name },
    data,
  });
}

export async function incrementAgentStats(name, stats) {
  return prisma.agent.update({
    where: { name },
    data: {
      totalStreams: stats.totalStreams ? { increment: 1 } : undefined,
      totalWatchTime: stats.watchTime ? { increment: stats.watchTime } : undefined,
      peakViewers: stats.peakViewers ? { max: stats.peakViewers } : undefined,
      lastStreamAt: stats.lastStreamAt || undefined,
    },
  });
}

// ============ STREAMS ============

export async function createStream(agentId, title) {
  return prisma.stream.create({
    data: {
      agentId,
      title,
    },
  });
}

export async function endStream(streamId, stats = {}) {
  return prisma.stream.update({
    where: { id: streamId },
    data: {
      endedAt: new Date(),
      peakViewers: stats.peakViewers || 0,
      totalViews: stats.totalViews || 0,
    },
  });
}

export async function getAgentStreams(agentId, limit = 10) {
  return prisma.stream.findMany({
    where: { agentId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}

// ============ CHAT MESSAGES ============

export async function saveChatMessage(data) {
  return prisma.chatMessage.create({
    data: {
      streamId: data.streamId,
      agentId: data.agentId,
      type: data.type,
      username: data.username,
      content: data.content,
    },
  });
}

export async function getStreamChatHistory(streamId, limit = 100) {
  return prisma.chatMessage.findMany({
    where: { streamId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

// ============ VIEWERS ============

export async function getOrCreateViewer(username) {
  return prisma.viewer.upsert({
    where: { username },
    update: {},
    create: { username, displayName: username },
  });
}

export async function incrementViewerStats(username, stats) {
  return prisma.viewer.update({
    where: { username },
    data: {
      totalWatchTime: stats.watchTime ? { increment: stats.watchTime } : undefined,
      messageCount: stats.messageCount ? { increment: 1 } : undefined,
    },
  });
}
