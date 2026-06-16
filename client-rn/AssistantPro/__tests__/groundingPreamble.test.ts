import { createGroundingPreambleController } from '../../src/services/groundingPreamble';

describe('grounding preamble controller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('speaks once when request is slow', () => {
    const speak = jest.fn();
    const stop = jest.fn();

    const controller = createGroundingPreambleController({
      enabled: true,
      delayMs: 100,
      callbacks: { speak, stop },
    });

    controller.arm();
    jest.advanceTimersByTime(120);

    expect(speak).toHaveBeenCalledTimes(1);
    expect(controller.hasSpoken()).toBe(true);
  });

  it('suppresses preamble for fast responses', () => {
    const speak = jest.fn();
    const stop = jest.fn();

    const controller = createGroundingPreambleController({
      enabled: true,
      delayMs: 100,
      callbacks: { speak, stop },
    });

    controller.arm();
    controller.markResponseStarted();
    jest.advanceTimersByTime(120);

    expect(speak).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('cancels active preamble when response starts', () => {
    const speak = jest.fn();
    const stop = jest.fn();

    const controller = createGroundingPreambleController({
      enabled: true,
      delayMs: 100,
      callbacks: { speak, stop },
    });

    controller.arm();
    jest.advanceTimersByTime(120);
    controller.markResponseStarted();

    expect(speak).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('finalize cancels active preamble on timeout/error', () => {
    const speak = jest.fn();
    const stop = jest.fn();

    const controller = createGroundingPreambleController({
      enabled: true,
      delayMs: 100,
      callbacks: { speak, stop },
    });

    controller.arm();
    jest.advanceTimersByTime(120);
    controller.finalize();

    expect(speak).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const speak = jest.fn();
    const stop = jest.fn();

    const controller = createGroundingPreambleController({
      enabled: false,
      delayMs: 100,
      callbacks: { speak, stop },
    });

    controller.arm();
    jest.advanceTimersByTime(120);
    controller.markResponseStarted();
    controller.finalize();

    expect(speak).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});
