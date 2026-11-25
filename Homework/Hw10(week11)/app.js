// app.js - 完整穩定版 (含真實巡目、電腦自摸互抓、台數結算、演示必勝腳本)

function playTileSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(650, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {}
}

function calculateTaiBreakdown(currentHand, melds, isTsumo) {
  let items = [];
  let total = 0;

  items.push({ name: "底", tai: 1 });
  total += 1;

  if (isTsumo) {
    items.push({ name: "自摸", tai: 1 });
    total += 1;
  }

  if (melds.length === 0) {
    items.push({ name: "門清", tai: 1 });
    total += 1;
    if (isTsumo) {
      items.push({ name: "不求人", tai: 1 });
      total += 1;
    }
  }

  let isAllTriplets = true;
  for (const m of melds) {
    if (m.length >= 3 && (m[0] !== m[1] || m[1] !== m[2])) {
      isAllTriplets = false;
      break;
    }
  }
  if (isAllTriplets) {
    const counts = {};
    currentHand.forEach(t => counts[t] = (counts[t] || 0) + 1);
    let pairCount = 0;
    for (const t in counts) {
      if (counts[t] === 2) pairCount++;
      else if (counts[t] === 3 || counts[t] === 4) {}
      else { isAllTriplets = false; break; }
    }
    if (isAllTriplets && pairCount === 1) {
      items.push({ name: "碰碰胡 (對對胡)", tai: 4 });
      total += 4;
    }
  }

  return { items, total };
}

function triggerCalloutBanner(actorName, actionText) {
  playTileSound();
  const banner = document.getElementById("callout-banner");
  const actor = document.getElementById("callout-actor");
  const text = document.getElementById("callout-text");
  
  if (!banner || !actor || !text) return;

  actor.innerText = actorName;
  text.innerText = actionText;
  banner.style.display = "block";

  banner.classList.remove("callout-overlay");
  void banner.offsetWidth;
  banner.classList.add("callout-overlay");

  setTimeout(() => {
    banner.style.display = "none";
  }, 850);
}

function triggerDrawGameModal() {
  playTileSound();
  const modal = document.getElementById("draw-game-modal");
  const reviewText = document.getElementById("draw-review-text");

  let waits = [];
  try { waits = getWaitingTiles(hand, playerMelds.length); } catch(e){}

  if (reviewText) {
    if (waits.length > 0) {
      reviewText.innerHTML = `
        <span style="color:#00e676; font-weight:bold;">✅【成功聽牌・守住底線】</span><br>
        局終你已進入聽牌狀態（聽 <strong>${waits.join("、")}</strong>）！整局沉著應戰、未曾放槍，成功守住平局，實戰表現優秀！
      `;
    } else {
      reviewText.innerHTML = `
        <span style="color:#ffb74d; font-weight:bold;">⚠️【牌效落後・未能聽牌】</span><br>
        72 張牌已摸完，手牌未能及時湊齊 5 組面子。下次記得緊跟綠光最優解，或適時吃碰牌加速前進！
      `;
    }
  }

  if (modal) modal.style.display = "flex";
}

function triggerBotWinModal(winnerName, loserName, winTile, isTsumo) {
  playTileSound();
  const modal = document.getElementById("bot-win-modal");
  const banner = document.getElementById("bot-win-banner");
  const subtitle = document.getElementById("bot-win-subtitle");
  const tileLabel = document.getElementById("bot-win-tile-label");
  const tileBox = document.getElementById("bot-win-tile-box");

  if (isTsumo) {
    banner.innerText = `🀄 ${winnerName} 自摸胡牌！ 🀄`;
    subtitle.innerText = `${winnerName} 運氣爆棚，從牌山絕殺摸進胡牌張！`;
    tileLabel.innerText = "自摸胡牌張：";
  } else {
    banner.innerText = `💥 ${winnerName} 胡牌！${loserName} 放槍！ 💥`;
    subtitle.innerText = `${loserName} 不慎打出危險牌，被 ${winnerName} 當場捉銃！`;
    tileLabel.innerText = "放槍胡牌張：";
  }

  if (tileBox) {
    tileBox.innerHTML = `<div class="tile ${getTileClass(winTile)}" style="width: 58px; height: 84px; font-size: 26px; margin: 0 auto; box-shadow: 0 0 25px #ffd700;">${winTile}</div>`;
  }

  if (modal) modal.style.display = "flex";
}

function sortHand(cards) {
  if (!cards) return [];
  return cards.sort((a, b) => TILE_NAMES.indexOf(a) - TILE_NAMES.indexOf(b));
}

function createFullDeck() {
  let deck = [];
  for (const name of TILE_NAMES) {
    for (let i = 0; i < 4; i++) deck.push(name);
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

let wallDeck = [];
let hand = [];
let playerMelds = [];
let rivers = { bottom: [], right: [], top: [], left: [] };
let isDefenseMode = false;
let isProcessingTurn = false;
let roundCount = 0;

let opponents = {
  top:   { name: "對家・楊姐", key: "top",   badgeId: "top-threat-badge",   isTenpai: false, waits: [], melds: [] },
  right: { name: "下家・鍋底", key: "right", badgeId: "right-threat-badge", isTenpai: false, waits: [], melds: [] },
  left:  { name: "上家・小亮", key: "left",  badgeId: "left-threat-badge",  isTenpai: false, waits: [], melds: [] }
};

function getTileClass(t) {
  if (!t) return "";
  if (t.includes("萬")) return "wan";
  if (t.includes("條")) return "tiao";
  if (t.includes("筒")) return "tong";
  return "";
}

function getAllRiverTiles() {
  return [...rivers.bottom, ...rivers.right, ...rivers.top, ...rivers.left];
}

function getMaxHandCount() {
  return (16 - playerMelds.length * 3) + 1;
}

function getActiveThreatOpponent() {
  for (let key in opponents) {
    if (opponents[key].isTenpai) return opponents[key];
  }
  return null;
}

function startRealGame() {
  wallDeck = shuffle(createFullDeck());
  hand = sortHand(wallDeck.splice(0, 16));
  playerMelds = [];
  wallDeck.splice(0, 16 * 3);

  rivers = {
    bottom: [],
    right: [wallDeck.pop()],
    top: [wallDeck.pop()],
    left: [wallDeck.pop()]
  };

  roundCount = 0;

  ["top", "right", "left"].forEach(k => {
    opponents[k].isTenpai = false;
    opponents[k].waits = [];
    opponents[k].melds = [];
    const b = document.getElementById(opponents[k].badgeId);
    if (b) b.style.display = "none";
  });

  isProcessingTurn = false;
  const bar = document.getElementById("meld-action-bar");
  if (bar) bar.style.display = "none";

  render();
}

function render() {
  const wallEl = document.getElementById("wall-count");
  if (wallEl) wallEl.innerText = wallDeck.length;

  const handBox = document.getElementById("player-hand");
  if (!handBox) return;
  handBox.innerHTML = "";

  try { renderOpponentHands(); } catch(e){}
  try { renderPlayerMelds(); } catch(e){}
  try { renderOpponentMelds(); } catch(e){}
  try { renderRivers(); } catch(e){}

  const hudCard = document.getElementById("ai-hud");
  const hudPulse = document.getElementById("hud-pulse");
  const hudTitle = document.getElementById("hud-title");
  const activeThreat = getActiveThreatOpponent();

  if (hudCard) {
    if (isDefenseMode) {
      hudCard.classList.add("defense-mode");
      if (hudPulse) hudPulse.classList.add("blue");
      if (hudTitle) {
        hudTitle.classList.add("blue");
        hudTitle.innerText = "AI 副駕駛即時戰術指引 (🛡️ 防放槍防守模式)";
      }
    } else {
      hudCard.classList.remove("defense-mode");
      if (hudPulse) hudPulse.classList.remove("blue");
      if (hudTitle) {
        hudTitle.classList.remove("blue");
        hudTitle.innerText = "AI 副駕駛即時戰術指引 (🟢 最佳進攻模式)";
      }
    }
  }

  const maxHand = getMaxHandCount();
  let tactics = null;

  try {
    if (hand.length === maxHand && typeof evaluateHandTactics === "function") {
      tactics = evaluateHandTactics(hand, getAllRiverTiles(), isDefenseMode, playerMelds.length);
    }
  } catch (err) {
    console.warn("Tactics error:", err);
  }

  const turnInd = document.getElementById("turn-indicator");
  const coachEl = document.getElementById("coach-text");

  if (hand.length === maxHand) {
    if (turnInd) {
      turnInd.innerText = "請你出牌";
      turnInd.style.background = isDefenseMode ? "#1976d2" : "#e65100";
    }
    if (coachEl) {
      coachEl.innerHTML = tactics ? tactics.advice : "請點選手牌中發綠光的牌打出！";
    }
  } else {
    if (turnInd) {
      turnInd.innerText = "輪到你";
      turnInd.style.background = "#2e7d32";
    }
    if (coachEl) {
      let waits = [];
      try { waits = getWaitingTiles(hand, playerMelds.length); } catch(e){}
      if (waits.length > 0) {
        coachEl.innerHTML = `🔥 <strong>已進入聽牌狀態</strong>！目前聽【<span style="color:#ffd54f;">${waits.join("、")}</span>】！點擊<strong>摸牌</strong>！`;
      } else {
        if (activeThreat) {
          coachEl.innerHTML = isDefenseMode 
            ? `🛡️ <strong>警戒中</strong>：${activeThreat.name}在第 ${roundCount} 巡聽牌了！摸牌後請打發藍光的安全牌！`
            : `手牌組織中（⚠️ 提醒：${activeThreat.name}已聽牌）。點擊<strong>「摸牌」</strong>前進！`;
        } else {
          coachEl.innerHTML = `🌱 <strong>序盤（第 ${roundCount + 1} 巡）</strong>：四家均在理牌，無放槍風險，請安心進攻！點擊<strong>「摸牌」</strong>！`;
        }
      }
    }
  }

  hand.forEach((tile, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "tile-wrapper";

    const el = document.createElement("div");
    el.className = `tile ${getTileClass(tile)}`;

    if (tactics) {
      if (index === tactics.recommendedIndex) {
        el.classList.add(isDefenseMode ? "ai-defense" : "ai-offense");
      }

      if (tactics.safetyList && tactics.safetyList[index]) {
        const safetyInfo = tactics.safetyList[index];
        if (safetyInfo.risk === "DANGER" && activeThreat) {
          const tag = document.createElement("span");
          tag.className = "danger-tag";
          tag.innerText = "!";
          wrapper.appendChild(tag);
        } else if (safetyInfo.risk === "SAFE") {
          const tag = document.createElement("span");
          tag.className = "safe-tag";
          tag.innerText = "🛡️";
          wrapper.appendChild(tag);
        }
      }
    }

    el.innerText = tile;
    el.onclick = () => discardTile(index);
    wrapper.appendChild(el);
    handBox.appendChild(wrapper);
  });
}

function renderPlayerMelds() {
  const container = document.getElementById("player-melds");
  if (!container) return;
  container.innerHTML = "";
  playerMelds.forEach(set => {
    const setEl = document.createElement("div");
    setEl.className = "meld-set";
    set.forEach(t => {
      const tileEl = document.createElement("div");
      tileEl.className = `tile ${getTileClass(t)}`;
      tileEl.innerText = t;
      setEl.appendChild(tileEl);
    });
    container.appendChild(setEl);
  });
}

function renderOpponentMelds() {
  ["top", "left", "right"].forEach(pos => {
    const box = document.getElementById(`melds-${pos}`);
    if (!box) return;
    box.innerHTML = "";
    if (opponents[pos] && opponents[pos].melds) {
      opponents[pos].melds.forEach(set => {
        const setEl = document.createElement("div");
        setEl.className = "meld-set";
        set.forEach(t => {
          const tileEl = document.createElement("div");
          tileEl.className = `tile ${getTileClass(t)}`;
          tileEl.innerText = t;
          setEl.appendChild(tileEl);
        });
        box.appendChild(setEl);
      });
    }
  });
}

function renderOpponentHands() {
  const topCount = 16 - (opponents.top.melds ? opponents.top.melds.length * 3 : 0);
  const t = document.getElementById("hand-top");
  if (t) t.innerHTML = Array(topCount).fill('<div class="tile-back-h"></div>').join("");

  const leftCount = 16 - (opponents.left.melds ? opponents.left.melds.length * 3 : 0);
  const l = document.getElementById("hand-left");
  if (l) l.innerHTML = Array(leftCount).fill('<div class="tile-back-v"></div>').join("");

  const rightCount = 16 - (opponents.right.melds ? opponents.right.melds.length * 3 : 0);
  const r = document.getElementById("hand-right");
  if (r) r.innerHTML = Array(rightCount).fill('<div class="tile-back-v"></div>').join("");
}

function renderRivers() {
  ["top", "bottom", "left", "right"].forEach(pos => {
    const box = document.getElementById(`river-${pos}`);
    if (!box) return;
    box.innerHTML = "";
    rivers[pos].forEach(t => {
      const el = document.createElement("div");
      el.className = `tile ${getTileClass(t)}`;
      el.innerText = t;
      box.appendChild(el);
    });
  });
}

document.getElementById("draw-btn").onclick = () => {
  if (isProcessingTurn) return;
  const maxHand = getMaxHandCount();
  if (hand.length >= maxHand) {
    alert("手牌已滿！請直接點擊下方發光的牌打出！");
    return;
  }
  if (wallDeck.length === 0) {
    triggerDrawGameModal();
    return;
  }

  const drawTile = wallDeck.pop();
  playTileSound();

  let waits = [];
  try { waits = getWaitingTiles(hand, playerMelds.length); } catch(e){}
  hand.push(drawTile);

  if (waits.includes(drawTile) && !isDefenseMode) {
    const textEl = document.getElementById("win-tile-text");
    if (textEl) textEl.innerText = `摸到【${drawTile}】！`;
    const winBox = document.getElementById("win-tile-box");
    if (winBox) {
      winBox.innerHTML = `<div class="tile ${getTileClass(drawTile)}" style="width: 58px; height: 84px; font-size: 26px; margin: 0 auto; box-shadow: 0 0 25px #ffd700;">${drawTile}</div>`;
    }

    const { items, total } = calculateTaiBreakdown(hand, playerMelds, true);
    const taiListEl = document.getElementById("win-tai-list");
    if (taiListEl) {
      taiListEl.innerHTML = items.map(it => `
        <li>
          <span>${it.name}</span>
          <span class="tai-val">+${it.tai} 台</span>
        </li>
      `).join("");
    }
    const totalEl = document.getElementById("win-total-tai");
    if (totalEl) totalEl.innerText = `${total} 台`;

    const modal = document.getElementById("win-modal");
    if (modal) modal.style.display = "flex";
    return;
  }

  render();
};

function discardTile(index) {
  if (isProcessingTurn) return;
  const maxHand = getMaxHandCount();
  if (hand.length < maxHand) {
    alert("尚未摸牌或副露未出牌，請先摸牌！");
    return;
  }

  const discarded = hand.splice(index, 1)[0];
  playTileSound();

  const activeThreat = getActiveThreatOpponent();
  if (activeThreat && activeThreat.waits.includes(discarded)) {
    const desc = document.getElementById("lose-opponent-desc");
    if (desc) desc.innerText = `你不聽 AI 勸告打了危險生張，${activeThreat.name} 當場拍桌胡牌！`;
    const label = document.getElementById("lose-tile-label");
    if (label) label.innerText = `${activeThreat.name} 胡你的這張牌：`;
    const loseBox = document.getElementById("lose-tile-box");
    if (loseBox) {
      loseBox.innerHTML = `<div class="tile ${getTileClass(discarded)}" style="width: 58px; height: 84px; font-size: 26px; margin: 0 auto; box-shadow: 0 0 25px #f44336;">${discarded}</div>`;
    }
    const loseModal = document.getElementById("lose-modal");
    if (loseModal) loseModal.style.display = "flex";
    return;
  }

  rivers.bottom.push(discarded);
  hand = sortHand(hand);
  render();

  runOpponentsTurn();
}

function runOpponentsTurn() {
  isProcessingTurn = true;
  roundCount++;

  if (roundCount >= 5 && !getActiveThreatOpponent()) {
    const keys = ["top", "right", "left"];
    const luckyKey = keys[Math.floor(Math.random() * keys.length)];
    const pool = ["5萬", "2萬", "6條", "3筒", "8萬", "5條"];
    opponents[luckyKey].isTenpai = true;
    opponents[luckyKey].waits = [
      pool[Math.floor(Math.random() * pool.length)],
      pool[Math.floor(Math.random() * pool.length)]
    ];
    const b = document.getElementById(opponents[luckyKey].badgeId);
    if (b) b.style.display = "inline-block";
  }

  const turns = [
    { key: "right", name: "下家・鍋底", canChow: false },
    { key: "top",   name: "對家・楊姐", canChow: false },
    { key: "left",  name: "上家・小亮", canChow: true }
  ];

  let step = 0;
  function nextBot() {
    if (wallDeck.length === 0) {
      isProcessingTurn = false;
      triggerDrawGameModal();
      return;
    }

    if (step >= turns.length) {
      isProcessingTurn = false;
      const turnInd = document.getElementById("turn-indicator");
      if (turnInd) {
        turnInd.innerText = "輪到你";
        turnInd.style.background = "#2e7d32";
      }
      return;
    }

    const currentBot = turns[step];
    const turnInd = document.getElementById("turn-indicator");
    if (turnInd) {
      turnInd.innerText = currentBot.name;
      turnInd.style.background = "#1565c0";
    }

    setTimeout(() => {
      playTileSound();
      const botTile = wallDeck.pop();
      const botObj = opponents[currentBot.key];

      if (botObj.isTenpai && botObj.waits.includes(botTile)) {
        isProcessingTurn = false;
        triggerBotWinModal(botObj.name, "", botTile, true);
        return;
      }

      for (let otherKey of ["right", "top", "left"]) {
        if (otherKey !== currentBot.key) {
          const waitingBot = opponents[otherKey];
          if (waitingBot.isTenpai && waitingBot.waits.includes(botTile)) {
            isProcessingTurn = false;
            triggerBotWinModal(waitingBot.name, currentBot.name, botTile, false);
            return;
          }
        }
      }

      rivers[currentBot.key].push(botTile);
      renderRivers();
      const wallEl = document.getElementById("wall-count");
      if (wallEl) wallEl.innerText = wallDeck.length;

      const playerCheck = checkPlayerMeldOptions(botTile, currentBot.canChow);
      if (playerCheck.canPung || playerCheck.canChow || playerCheck.canKong) {
        promptMeldAction(botTile, playerCheck, currentBot.name, () => {
          checkBotsMeldInterruption(botTile, currentBot.key, () => {
            step++;
            nextBot();
          });
        });
      } else {
        checkBotsMeldInterruption(botTile, currentBot.key, () => {
          step++;
          nextBot();
        });
      }
    }, 700);
  }

  setTimeout(nextBot, 500);
}

function checkBotsMeldInterruption(tile, currentBotKey, onContinue) {
  const otherKeys = ["right", "top", "left"].filter(k => k !== currentBotKey);
  const randomBotKey = otherKeys[Math.floor(Math.random() * otherKeys.length)];

  if (Math.random() < 0.10 && wallDeck.length > 5 && opponents[randomBotKey].melds.length < 2) {
    const bot = opponents[randomBotKey];

    triggerCalloutBanner(bot.name, "🀄 碰！");

    setTimeout(() => {
      bot.melds.push([tile, tile, tile]);
      renderOpponentMelds();
      renderOpponentHands();

      if (wallDeck.length > 0) {
        const discardTile = wallDeck.pop();
        rivers[bot.key].push(discardTile);
        renderRivers();
      }
      onContinue();
    }, 900);
  } else {
    onContinue();
  }
}

function checkPlayerMeldOptions(tile, canChowFromThisPlayer) {
  const count = hand.filter(t => t === tile).length;
  const canPung = count >= 2;
  const canKong = count >= 3;

  let chowCombos = [];
  const id = tileToId(tile);
  if (canChowFromThisPlayer && id < 27) {
    const suit = tile.slice(-1);
    const num = parseInt(tile);
    if (hand.includes(`${num-2}${suit}`) && hand.includes(`${num-1}${suit}`)) {
      chowCombos.push([`${num-2}${suit}`, `${num-1}${suit}`, tile]);
    }
    if (hand.includes(`${num-1}${suit}`) && hand.includes(`${num+1}${suit}`)) {
      chowCombos.push([`${num-1}${suit}`, tile, `${num+1}${suit}`]);
    }
    if (hand.includes(`${num+1}${suit}`) && hand.includes(`${num+2}${suit}`)) {
      chowCombos.push([tile, `${num+1}${suit}`, `${num+2}${suit}`]);
    }
  }

  return { canPung, canKong, canChow: chowCombos.length > 0, chowCombos };
}

function evaluateMeldAdvice(tile, check) {
  const activeThreat = getActiveThreatOpponent();

  if (isDefenseMode) {
    const name = activeThreat ? activeThreat.name : "對手";
    return {
      action: "SKIP",
      title: "🛡️ 建議【過 (別吃碰)】",
      reason: `${name}正在聽牌警戒！吃碰會縮短手牌張數失去防守退路，建議按【過】留著安全牌防放槍！`
    };
  }

  if (check.canKong) {
    return {
      action: "KONG",
      title: "👑 建議【槓牌】！",
      reason: `手裡已有 3 張【${tile}】，槓牌能增加台數並從牌山底摸一張補牌，有機會槓上開花！`
    };
  }

  if (check.canPung) {
    let tempHand = [...hand];
    let removed = 0;
    tempHand = tempHand.filter(t => {
      if (t === tile && removed < 2) { removed++; return false; }
      return true;
    });

    let waitsAfterPung = [];
    try { waitsAfterPung = getWaitingTiles(tempHand, playerMelds.length + 1); } catch(e){}
    if (waitsAfterPung.length > 0) {
      return {
        action: "PUNG",
        title: "🟢 強烈建議【碰牌】！",
        reason: `碰了這張【${tile}】之後，手牌直接<strong>進入聽牌狀態</strong>（聽 ${waitsAfterPung.join("、")}），大幅縮短胡牌時間！`
      };
    }

    if (playerMelds.length >= 2) {
      return {
        action: "SKIP",
        title: "🟡 建議【過 (保留手牌)】",
        reason: `你已經倒牌 ${playerMelds.length} 組，再碰會讓手牌過短容易放槍，建議按【過】！`
      };
    }

    return {
      action: "PUNG",
      title: "🟢 建議【碰牌】",
      reason: `碰出刻子能快速湊滿一組面子，加快成牌進度！`
    };
  }

  if (check.canChow) {
    const combo = check.chowCombos[0];
    let tempHand = [...hand];
    const needed = combo.filter(t => t !== tile);
    needed.forEach(t => {
      const idx = tempHand.indexOf(t);
      if (idx !== -1) tempHand.splice(idx, 1);
    });

    let waitsAfterChow = [];
    try { waitsAfterChow = getWaitingTiles(tempHand, playerMelds.length + 1); } catch(e){}
    if (waitsAfterChow.length > 0) {
      return {
        action: "CHOW",
        title: "🟢 強烈建議【吃牌】！",
        reason: `吃進【${tile}】組成 ${combo.join("")} 順子後，手牌直接<strong>進入聽牌狀態</strong>！快點吃牌！`
      };
    }

    return {
      action: "CHOW",
      title: "🟢 建議【吃牌】",
      reason: `吃進【${tile}】能將手牌中的零碎搭子化為順子面子，有助於理順手牌！`
    };
  }

  return {
    action: "SKIP",
    title: "建議【過】",
    reason: "目前無需副露，保持手牌節奏摸牌即可。"
  };
}

function promptMeldAction(tile, check, botName, onSkip) {
  const bar = document.getElementById("meld-action-bar");
  const promptText = document.getElementById("meld-prompt");
  const chowBtn = document.getElementById("btn-action-chow");
  const pungBtn = document.getElementById("btn-action-pung");
  const kongBtn = document.getElementById("btn-action-kong");
  const skipBtn = document.getElementById("btn-action-skip");

  const adviceTitle = document.getElementById("meld-ai-decision");
  const adviceDesc = document.getElementById("meld-ai-reason");

  [chowBtn, pungBtn, kongBtn, skipBtn].forEach(b => { if(b) b.classList.remove("recommended"); });

  const advice = evaluateMeldAdvice(tile, check);
  if (adviceTitle) adviceTitle.innerHTML = advice.title;
  if (adviceDesc) adviceDesc.innerHTML = advice.reason;

  if (promptText) promptText.innerHTML = `${botName} 打出【<span style="color:#ffd54f;">${tile}</span>】！`;
  if (bar) bar.style.display = "flex";

  if (chowBtn) chowBtn.style.display = check.canChow ? "block" : "none";
  if (pungBtn) pungBtn.style.display = check.canPung ? "block" : "none";
  if (kongBtn) kongBtn.style.display = check.canKong ? "block" : "none";

  if (advice.action === "PUNG" && check.canPung && pungBtn) pungBtn.classList.add("recommended");
  else if (advice.action === "CHOW" && check.canChow && chowBtn) chowBtn.classList.add("recommended");
  else if (advice.action === "KONG" && check.canKong && kongBtn) kongBtn.classList.add("recommended");
  else if (skipBtn) skipBtn.classList.add("recommended");

  if (pungBtn) pungBtn.onclick = () => { if(bar) bar.style.display = "none"; executePung(tile); };
  if (chowBtn) chowBtn.onclick = () => { if(bar) bar.style.display = "none"; executeChow(check.chowCombos[0], tile); };
  if (kongBtn) kongBtn.onclick = () => { if(bar) bar.style.display = "none"; executeKong(tile); };
  if (skipBtn) skipBtn.onclick = () => { if(bar) bar.style.display = "none"; onSkip(); };
}

function executePung(tile) {
  triggerCalloutBanner("你", "🀄 碰！");
  let removed = 0;
  hand = hand.filter(t => {
    if (t === tile && removed < 2) { removed++; return false; }
    return true;
  });

  playerMelds.push([tile, tile, tile]);
  isProcessingTurn = false;
  render();
}

function executeChow(combo, tile) {
  triggerCalloutBanner("你", "🥢 吃！");
  const neededFromHand = combo.filter(t => t !== tile);
  neededFromHand.forEach(t => {
    const idx = hand.indexOf(t);
    if (idx !== -1) hand.splice(idx, 1);
  });

  playerMelds.push(combo);
  isProcessingTurn = false;
  render();
}

function executeKong(tile) {
  triggerCalloutBanner("你", "👑 槓！");
  hand = hand.filter(t => t !== tile);
  playerMelds.push([tile, tile, tile, tile]);
  if (wallDeck.length > 0) hand.push(wallDeck.pop());
  isProcessingTurn = false;
  render();
}

document.getElementById("toggle-defense-btn").onclick = () => {
  isDefenseMode = !isDefenseMode;
  const btn = document.getElementById("toggle-defense-btn");
  if (isDefenseMode) {
    btn.classList.add("active");
    btn.innerText = "⚔️ 切換進攻模式";
  } else {
    btn.classList.remove("active");
    btn.innerText = "🛡️ 切換防放槍下車";
  }
  playTileSound();
  render();
};

// ⚡ 上台演示專用按鈕（保證 100% 4 台自摸必勝腳本，精確安排 50 張牌山底）
document.getElementById("demo-preset-btn").onclick = () => {
  const dummyTiles = Array(50).fill("8萬");
  wallDeck = [...dummyTiles, "2萬", "3條", "1筒", "9條"];

  hand = ["3萬","4萬","5萬","6萬","7萬","7萬","7萬","1條","2條","3條","東","東","東","南","南","南","9萬"];
  playerMelds = [];

  ["top", "right", "left"].forEach(k => {
    opponents[k].isTenpai = false;
    opponents[k].melds = [];
    const b = document.getElementById(opponents[k].badgeId);
    if (b) b.style.display = "none";
  });

  opponents.top.melds = [["7萬", "7萬", "7萬"]];
  opponents.top.isTenpai = true;
  opponents.top.waits = ["8筒"];
  const tb = document.getElementById("top-threat-badge");
  if (tb) tb.style.display = "inline-block";

  isDefenseMode = false;
  const db = document.getElementById("toggle-defense-btn");
  if (db) {
    db.innerText = "🛡️ 切換防放槍下車";
    db.classList.remove("active");
  }
  
  playTileSound();
  render();
};

document.getElementById("reset-btn").onclick = () => {
  playTileSound();
  startRealGame();
};

startRealGame();