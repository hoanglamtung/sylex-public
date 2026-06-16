process.env.NODE_ENV = 'test';

import ChatService from '../../src/services/chatService.js';

describe('ChatService system prompt routine intent support', () => {
  it('includes start_routine in the output action schema', () => {
    const chatService = new ChatService();
    const prompt = chatService.getSystemPrompt();

    expect(prompt).toContain('"action": "<answer | navigate | call | draft_email | search | start_routine | none>"');
  });

  it('documents routine mappings for morning, evening, and workday', () => {
    const chatService = new ChatService();
    const prompt = chatService.getSystemPrompt();

    expect(prompt).toContain('ROUTINE INTENT (start_routine)');
    expect(prompt).toContain('routineId: "morning"');
    expect(prompt).toContain('routineId: "evening"');
    expect(prompt).toContain('routineId: "workday"');
  });
});
