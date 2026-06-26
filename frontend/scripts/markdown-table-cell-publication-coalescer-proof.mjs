import assert from 'node:assert/strict';

function createPublicationCoalescer({ triggerPublication }) {
  let desiredGeneration = 0;
  let scheduled = false;
  let inFlightGeneration = 0;
  let needsRetrigger = false;
  let pendingPromise = null;
  let resolvePendingPromise = null;

  function scheduleTrigger() {
    if (scheduled || inFlightGeneration !== 0) {
      return;
    }

    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;

      if (inFlightGeneration !== 0 || desiredGeneration === 0) {
        return;
      }

      inFlightGeneration = desiredGeneration;
      triggerPublication(inFlightGeneration);
    });
  }

  return {
    requestPublication() {
      desiredGeneration += 1;

      if (pendingPromise === null) {
        pendingPromise = new Promise((resolve) => {
          resolvePendingPromise = resolve;
        });
      }

      if (inFlightGeneration !== 0) {
        needsRetrigger = true;
      }

      scheduleTrigger();
      return pendingPromise;
    },

    handlePublicationComplete(markdown) {
      assert.notEqual(inFlightGeneration, 0, 'expected a publication to be in flight before completion');

      if (needsRetrigger && desiredGeneration > inFlightGeneration) {
        inFlightGeneration = 0;
        needsRetrigger = false;
        scheduleTrigger();
        return;
      }

      const resolve = resolvePendingPromise;
      inFlightGeneration = 0;
      needsRetrigger = false;
      pendingPromise = null;
      resolvePendingPromise = null;

      resolve?.(markdown);
    },

    getState() {
      return {
        desiredGeneration,
        scheduled,
        inFlightGeneration,
        needsRetrigger,
        hasPendingPromise: pendingPromise !== null,
      };
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function runProof() {
  const triggerCalls = [];
  const coordinator = createPublicationCoalescer({
    triggerPublication(generation) {
      triggerCalls.push(generation);
    },
  });

  const firstPromise = coordinator.requestPublication();
  const secondPromise = coordinator.requestPublication();

  assert.strictEqual(firstPromise, secondPromise, 'coalesced requests before dispatch should share one pending promise');

  await flushMicrotasks();

  assert.deepEqual(triggerCalls, [2], 'coalesced pre-dispatch requests should trigger exactly once with the latest generation');
  assert.deepEqual(coordinator.getState(), {
    desiredGeneration: 2,
    scheduled: false,
    inFlightGeneration: 2,
    needsRetrigger: false,
    hasPendingPromise: true,
  });

  const thirdPromise = coordinator.requestPublication();
  assert.strictEqual(thirdPromise, firstPromise, 'requests during an in-flight publication should still share the same pending promise');

  coordinator.handlePublicationComplete('stale-markdown');
  await flushMicrotasks();

  assert.deepEqual(triggerCalls, [2, 3], 'a completion observed while newer work is pending should schedule exactly one retrigger with the latest generation');
  assert.deepEqual(coordinator.getState(), {
    desiredGeneration: 3,
    scheduled: false,
    inFlightGeneration: 3,
    needsRetrigger: false,
    hasPendingPromise: true,
  });

  let resolvedMarkdown = null;
  firstPromise.then((markdown) => {
    resolvedMarkdown = markdown;
  });

  coordinator.handlePublicationComplete('latest-markdown');
  await flushMicrotasks();

  assert.equal(resolvedMarkdown, 'latest-markdown', 'the shared promise should resolve only after the latest in-flight publication completes');
  assert.deepEqual(coordinator.getState(), {
    desiredGeneration: 3,
    scheduled: false,
    inFlightGeneration: 0,
    needsRetrigger: false,
    hasPendingPromise: false,
  });

  const nextTriggerCalls = [];
  const nextCoordinator = createPublicationCoalescer({
    triggerPublication(generation) {
      nextTriggerCalls.push(generation);
    },
  });

  const burstPromiseA = nextCoordinator.requestPublication();
  await flushMicrotasks();
  const burstPromiseB = nextCoordinator.requestPublication();
  const burstPromiseC = nextCoordinator.requestPublication();

  assert.strictEqual(burstPromiseA, burstPromiseB, 'all callers inside one unresolved burst should share the same promise');
  assert.strictEqual(burstPromiseB, burstPromiseC, 'all callers inside one unresolved burst should share the same promise');

  nextCoordinator.handlePublicationComplete('intermediate-markdown');
  await flushMicrotasks();

  assert.deepEqual(nextTriggerCalls, [1, 3], 'multiple in-flight requests should still retrigger only once for the latest generation');

  let burstResolvedMarkdown = null;
  burstPromiseA.then((markdown) => {
    burstResolvedMarkdown = markdown;
  });

  nextCoordinator.handlePublicationComplete('final-burst-markdown');
  await flushMicrotasks();

  assert.equal(
    burstResolvedMarkdown,
    'final-burst-markdown',
    'the coalesced promise should resolve with the final latest-wins publication result'
  );

  console.log('Proof 2C passed. Verified coalesced publication-contract facts:');
  console.log('- A queueMicrotask plus generation-counter coordinator can coalesce repeated publication requests into one shared pending promise.');
  console.log('- Requests issued before dispatch trigger exactly one latest-generation publication.');
  console.log('- Requests issued during an in-flight publication cause at most one retrigger for the latest generation.');
  console.log('- The shared promise resolves only after the latest publication completion is observed.');
  console.log('- Therefore, a concrete latest-wins flushPendingEdits() contract is feasible on top of the proven onChange completion boundary.');
}

runProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
