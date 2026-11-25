// mahjongEngine.js - 核心演算法引擎 (DFS剪枝回溯 + 張數動態自適應 + 孤張篩選)

const TILE_NAMES = [
  "1萬","2萬","3萬","4萬","5萬","6萬","7萬","8萬","9萬",
  "1筒","2筒","3筒","4筒","5筒","6筒","7筒","8筒","9筒",
  "1條","2條","3條","4條","5條","6條","7條","8條","9條",
  "東","南","西","北","中","發","白"
];

function tileToId(name) { return TILE_NAMES.indexOf(name); }
function idToTile(id) { return TILE_NAMES[id]; }

function isWinning(countMap, meldsNeeded = 5) {
  for (let i = 0; i < 34; i++) {
    if (countMap[i] >= 2) {
      countMap[i] -= 2;
      if (canFormMelds(countMap, meldsNeeded)) {
        countMap[i] += 2;
        return true;
      }
      countMap[i] += 2;
    }
  }
  return false;
}

function canFormMelds(counts, meldsNeeded) {
  if (meldsNeeded === 0) return true;
  let first = 0;
  while (first < 34 && counts[first] === 0) first++;
  if (first === 34) return true;

  if (counts[first] >= 3) {
    counts[first] -= 3;
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[first] += 3;
      return true;
    }
    counts[first] += 3;
  }

  if (first < 27 && (first % 9) <= 6) {
    if (counts[first + 1] > 0 && counts[first + 2] > 0) {
      counts[first]--; counts[first + 1]--; counts[first + 2]--;
      if (canFormMelds(counts, meldsNeeded - 1)) {
        counts[first]++; counts[first + 1]++; counts[first + 2]++;
        return true;
      }
      counts[first]++; counts[first + 1]++; counts[first + 2]++;
    }
  }
  return false;
}

function getWaitingTiles(handTiles, meldsCount = 0) {
  const neededMelds = 5 - meldsCount;
  const counts = new Array(34).fill(0);
  for (const tile of handTiles) {
    const id = tileToId(tile);
    if (id !== -1) counts[id]++;
  }

  const waitingList = [];
  for (let testId = 0; testId < 34; testId++) {
    if (counts[testId] < 4) {
      counts[testId]++;
      if (isWinning(counts, neededMelds)) {
        waitingList.push(idToTile(testId));
      }
      counts[testId]--;
    }
  }
  return waitingList;
}

function evaluateHandTactics(handCurrent, riverTiles, isDefenseMode, meldsCount = 0) {
  if (!handCurrent || handCurrent.length === 0) return null;

  const riverCounts = {};
  if (riverTiles) {
    riverTiles.forEach(t => riverCounts[t] = (riverCounts[t] || 0) + 1);
  }

  const handCounts = {};
  handCurrent.forEach(t => handCounts[t] = (handCounts[t] || 0) + 1);

  const tileSafetyList = handCurrent.map((tile, idx) => {
    const id = tileToId(tile);
    const seenCount = riverCounts[tile] || 0;
    const isHonor = id >= 27;
    const isMiddle = (id % 9 >= 3 && id % 9 <= 5) && !isHonor;

    let risk = "NORMAL";
    if (seenCount >= 2 || (isHonor && seenCount >= 1)) {
      risk = "SAFE";
    } else if (seenCount === 0 && isMiddle) {
      risk = "DANGER";
    }
    return { index: idx, tile, risk, seenCount };
  });

  let bestOffenseIndex = -1;
  let maxWaits = -1;
  let bestWaitingTiles = [];

  for (let i = 0; i < handCurrent.length; i++) {
    const handRemaining = [...handCurrent.slice(0, i), ...handCurrent.slice(i + 1)];
    const waits = getWaitingTiles(handRemaining, meldsCount);
    if (waits.length > maxWaits) {
      maxWaits = waits.length;
      bestOffenseIndex = i;
      bestWaitingTiles = waits;
    }
  }

  let bestDefenseIndex = 0;
  let foundSafe = false;
  for (let i = 0; i < tileSafetyList.length; i++) {
    if (tileSafetyList[i].risk === "SAFE") {
      bestDefenseIndex = i;
      foundSafe = true;
      break;
    }
  }
  if (!foundSafe) {
    for (let i = 0; i < handCurrent.length; i++) {
      const id = tileToId(handCurrent[i]);
      if (id >= 27 || (id % 9 === 0 || id % 9 === 8)) {
        bestDefenseIndex = i;
        break;
      }
    }
  }

  if (isDefenseMode) {
    const safeTile = handCurrent[bestDefenseIndex];
    return {
      recommendedIndex: bestDefenseIndex,
      mode: "DEFENSE",
      safetyList: tileSafetyList,
      advice: `🛡️ <strong>防放槍模式</strong>：推薦打出發藍光的絕對安全牌【${safeTile}】！`
    };
  }

  if (maxWaits > 0 && bestOffenseIndex !== -1) {
    const offenseTile = handCurrent[bestOffenseIndex];
    return {
      recommendedIndex: bestOffenseIndex,
      mode: "OFFENSE",
      safetyList: tileSafetyList,
      advice: `🟢 <strong>進攻最優解</strong>：打出綠光【${offenseTile}】！打掉立刻聽牌（聽 ${bestWaitingTiles.join("、")}）！`
    };
  }

  // 若尚未聽牌：智能挑選單張孤張（字牌優先）
  let orphanIndex = -1;
  for (let i = handCurrent.length - 1; i >= 0; i--) {
    const t = handCurrent[i];
    const id = tileToId(t);
    if (id >= 27 && handCounts[t] === 1) {
      orphanIndex = i;
      break;
    }
  }
  if (orphanIndex === -1) {
    for (let i = handCurrent.length - 1; i >= 0; i--) {
      const t = handCurrent[i];
      const id = tileToId(t);
      if (id < 27 && (id % 9 === 0 || id % 9 === 8) && handCounts[t] === 1) {
        orphanIndex = i;
        break;
      }
    }
  }
  if (orphanIndex === -1) {
    orphanIndex = handCurrent.length - 1;
  }

  const chosenTile = handCurrent[orphanIndex];
  return {
    recommendedIndex: orphanIndex,
    mode: "OFFENSE",
    safetyList: tileSafetyList,
    advice: `🟢 <strong>進攻最優解</strong>：手牌組織中，建議打出單張孤張【${chosenTile}】！保留其他搭子！`
  };
}