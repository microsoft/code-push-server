// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const DELIMITER = "-";

function getHashCode(input: string): number {
  let hash: number = 0;

  if (input.length === 0) {
    return hash;
  }

  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
  }

  return hash;
}

export function isSelectedForRollout(clientId: string, rollout: number, releaseTag: string): boolean {
  const identifier: string = clientId + DELIMITER + releaseTag;
  const hashValue: number = getHashCode(identifier);
  return Math.abs(hashValue) % 100 < rollout;
}

export function isUnfinishedRollout(rollout: number): boolean {
  return rollout && rollout !== 100;
}
