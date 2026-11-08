# COLD ROCK: DEADWEIGHT

**Design brief · revision 3 · working title**

> **A dying belt, a fat hold, and a long way home.**
> Every good rock is further from the relay. Every tonne makes the trip back longer.

**Status:** concept locked; 5-day feel gate next. This brief is the decision record after five design
iterations and three review rounds. It is deliberately more precise than a pitch and less detailed than
a full GDD.

**What changed after review**

- **One bank per run**, not three. The three-bank chain was not coherent with the clock or the
  distance economy; it is now a post-slice experiment.
- A real **distance/speed budget**: a 350 m-radius field and a slower, heavier ship.
- **Cut-driven drift with ghost-recorded rock deltas**, so the PB ghost flies the world the cuts
  created.
- The **long-loop test moves after the core slice**; the 5-day gate only tests mass and the return
  decision.
- **Guns are parked** in DEADWEIGHT. This is a mining-rig game.
- A **fill bonus plus an overflow penalty**, so greed is an interior decision rather than “always
  fill.”
- **Partial jettison**, auto-callsigns, no seasons, and a best-of-5 weekly board.

---

## 1. One-page pitch

**COLD ROCK: DEADWEIGHT** is a 2.5D browser arcade extraction game. You fly a heavy prospecting ship
into a collapsing asteroid claim, cut valuable seams, tractor the chunks into your hold, and decide
when to run for the relay.

The hook: **cargo is mass.** Every chunk makes the ship genuinely heavier — slower to accelerate,
slower to turn, slower to stop. There is no encumbrance icon and no debuff bar. The ship stops
answering the way it used to, and you feel the cost of greed through the controls.

A run is **two to two-and-a-half minutes**, one outbound trip and one bank. Fill the hold, feel it
go heavy, judge the trip home, and dock before the shift closes. The farther out you go, the richer
the rocks and the worse the return.

The long game is **mastery and comparison**, not an economy: permanent hand-authored fields, a
rotating weekly claim, personal-best ghosts, split times and medals. No accounts, no shop, no daily
streaks, no permanent power.

---

## 2. Product frame

- **Platform:** desktop browser first; gamepad and touch supported; no install.
- **Business:** free at launch; no ads, no accounts, no monetization, no paid advantage. The optional
  scoreboard should cost roughly $0–5/month, not a live-ops team.
- **Team:** two builders plus the existing COLD ROCK codebase. The slice reuses the current ship,
  asteroid, lighting and audio assets; no new **baked** art pipeline. The relay, gate and beacon are
  built from Pixi vector/glow primitives.
- **Session:** one run is 2–2.5 minutes; a session is 3–5 runs (8–15 minutes). The game must be
  satisfying in one attempt.
- **Mode:** DEADWEIGHT is **mining-rig only**. The gun battery is parked and disabled; the front
  mining barrels and six tractor mounts are the tools. A combat mode is a separate future game, not
  a hidden feature.

### Why it can be addictive

- **The handicap is the score.** Every chunk is value and a handling cost at once.
- **The risk is route-authored.** The belt destabilises because of where you cut; how deep you are when it shifts is your choice.
- **The comparison is personal.** A PB ghost and split ledger turn “I lost” into “I gave back six
  seconds in band C.”
- **The week is a shared puzzle.** Everyone gets the same procedural claim; the board is a
  conversation, not a treadmill.
- **One good run is enough.** The weekly board is best-of-5, not cumulative. Missing a week costs
  nothing.

### Tone and presentation

Cold industrial prospecting: bruised blue hull, amber hazard light, hard vacuum black, hand-lit
normal maps. Sparse HUD: relay bearing, hold, clock, return band, score. Mass feedback is diegetic —
the exhaust labouring, the hull creaking, the camera lagging, the nose overshooting.

Audio stays tonal and mechanical: engine hums detune under load, reverse thrust strains, shield
impacts flare. Existing beds carry the weight.

### UX and accessibility

- Boot straight into the run; no menu wall.
- **Pause:** Esc/window blur freezes the clock in the Prospect Ladder. Weekly-claim runs are
  single-sitting; a pause or visibility change ends board eligibility for that attempt, so the clock
  cannot be gamed.
- Retry resets the ship, hold and timer in place; the field meshes are reused, never rebuilt.
- Return band, hold gauge and overload cues use words/shape as well as colour; never colour alone.
- Respect existing reduced-motion support; camera shake gets an intensity toggle.
- Keyboard, gamepad and touch supported. Input remapping is deferred, not promised.
- Dock, retry and pause are reachable without a pointer; the weekly board is optional.

### First 90 seconds

| Time    | Beat                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| 0–5 s   | Empty ship leaves the relay; the handling baseline is established.                  |
| 5–15 s  | First seam cut; melt bloom and chunk ejection teach the verb.                       |
| 15–30 s | First chunk lands; hold gauge moves and the return band ticks one notch worse.      |
| 30–60 s | Commit to a band; the first real “go deeper or turn home” decision.                 |
| 60–90 s | Heavy turn, near-miss or deliberate jettison; the first “my cargo did that” moment. |

---

## 3. The run

### One bank

| Phase      | What happens                                   | Decision                                  |
| ---------- | ---------------------------------------------- | ----------------------------------------- |
| Launch     | Spawn on the relay, empty ship                 | Which band do I commit to?                |
| Mine       | Cut seams, tractor chunks; mass rises          | Go one more rock, or turn for home?       |
| Return     | Heavy, slower, self-corrupted corridor         | Push through, jettison, or accept the tow |
| Dock / end | Bank at the relay; run ends; score and summary | Retry, chase PB, or try the weekly claim  |

- One bank per run. Docking ends the run; a missed dock ends it with held cargo lost.
- The **5-day gate and the shipping slice use the same structure**. No hidden rule change.
- The **three-bank chain is a post-slice experiment**, not in this build. It is not referenced by the
  score, the test plan, or the weekly claim until it has its own design pass.

### Core verbs

- **Fly:** W/S thrust, A/D turn, mouse aim, X stabiliser. There is no weapon switching; the mining
  rig is always equipped and the gun battery is offline. Gamepad: left stick points the heading,
  RT/LT are analog main/reverse thrust, A fires the mining laser, B stabilises. Touch overlay
  supported.
- **Cut:** dwell the mining laser on a seam. Common seams roughly 0.6 s, hero seams roughly 1.1 s.
  Each cut yields 1–3 chunks.
- **Load:** six tractor beams pull chunks into the hull hatch; each delivered chunk adds mass.
- **Jettison:** tap dumps one unit; hold dumps the whole hold. Dumped cargo is gone and may become
  inert tailings.
- **Dock:** enter the relay to bank. Banked score stands; held cargo is at risk until then.

### Session shape

- A run is **120–150 seconds**.
- A session is **3–5 runs** (8–15 minutes). The game should be satisfying after one run and leave a
  reason for a second.
- The weekly claim is an optional additional attempt, not a daily ritual.

### Failure

- Towed or expired with cargo aboard: **100% of held cargo is lost**; no score is banked.
- Retry is one keypress, in-place, under 3 seconds. No reload, no fee, no repair bill.
- No permanent loss, no currency, no power progression. Failure costs a run and a story, not an hour.
- **Tow definition:** shift expiry plus a 10-second grace period to reach the relay; after that the
  run is towed. `LATE` gives a hard 6–8 s warning, and the summary always names the recoverable
  mistake (“docked at 78% / 11 s spare”). A tow is never a surprise.

### Why no bank streak

A streak rewards early, clean banking — exactly the cautious behaviour the game exists to punish. It
trains players out of greed. **No streak.** The PB ghost, split ledger and medals carry the long-term
chase.

---

## 4. Weight: how cargo is felt

### Numbers

| Property                      | Slice target                                        |
| ----------------------------- | --------------------------------------------------- |
| Hull mass                     | 18,500 kg                                           |
| Cargo capacity                | 20 units                                            |
| Mass per unit                 | 450 kg                                              |
| Full hold                     | 9,000 kg = **48.6% of hull mass**                   |
| Empty terminal speed          | **18 m/s** (DEADWEIGHT tuning, not the 54 m/s demo) |
| Full-hold terminal speed      | **~12 m/s**                                         |
| Full-hold linear acceleration | roughly −33% vs empty                               |
| Full-hold yaw response        | roughly **−33%**                                    |

- Cargo is loaded **uniformly**; the centre of mass never moves.
- Mass and inertia rise together via `shipInertiaKgM2`; yaw response follows approximately 1/mass.
  If playtesting needs more sluggishness, add an explicit **cargo inertia multiplier** as a tuning
  parameter — do not publish a fake −41% number.
- **Feel cues are in the gate.** Load-scaled angular damping and a load-aware camera follow are part
  of the 5-day scope; without them the overshoot cue is not real and gets cut from the pitch. The
  contract is: a heavier hold must visibly change how the ship leaves a turn.
- **35–50% of hull mass at full hold is the hard gate.** Below that, the hook is invisible on run 1.
- DEADWEIGHT gets its own flight tuning. The current demo’s 54 m/s terminal speed is too fast for the
  intended distances and mining rhythm.

### Legibility without a debuff bar

The ship is the readout:

- **Turn latency and nose overshoot.** Empty, release the turn and the nose stops. Full, it keeps
  swinging. This is the signature cue.
- **Camera lag.** The camera follows more slowly; the hull visibly stops leading.
- **Engine audio.** Hum detunes with load; exhaust plumes lengthen and shift amber.
- **Stabiliser recovery** takes visibly longer.
- **Overload tell.** Subtle at 25%, amber/creak at 50%, shake/band jitter at 80%, strain bed and
  `HOLD UNSTABLE` at 100%. Relief on jettison is the emotional loop.
- **Return band, not exact ETA.** `RELAXED / TIGHT / LATE` is conservative and recomputes
  immediately when cargo or the corridor changes. It may lag only because the world is visibly
  drifting; it never lies. A precise seconds countdown turns the game into arithmetic; a dishonest
  band destroys attribution.

---

## 5. The field

### Scale budget

The old 140 m field was crossed in seconds. DEADWEIGHT uses a larger, slower world:

| Property                       | Target                                      |
| ------------------------------ | ------------------------------------------- |
| Field radius                   | **350 m**                                   |
| Bands (distance from relay)    | A 30–70 · B 70–140 · C 140–240 · D 240–350  |
| Rock count                     | 36–60 (plus hero set pieces)                |
| Empty transit to far band      | ~15–21 s                                    |
| Full-hold return from far band | ~24–34 s                                    |
| Camera zoom                    | ~0.15–0.25, with an off-screen relay marker |
| Typical run split              | outbound 25% · mining 50% · return 25%      |
| Gate metric                    | return ≥18% of run and ≥1.4× outbound       |

These are **gate targets**, not shipped constants. The 5-day test validates the distance/speed budget
before any content is built on it.

### Grammar

- A **fixed relay** sits at the origin. The field is generated outward in **arcs/spiral bands**, not
  concentric circles: value and hazard rise with distance, but the return corridor is never just
  the outbound line reversed.
- One **hero rock** per field (3× scale); one **seam core** per band with a longer cut and double
  payout.
- **Band economy:** a chunk is one cargo unit; a cut yields the number of chunks shown in the table.

| Band | Cut time | Units/cut | Value/unit | Value/cut | Value/second | Cuts to fill 20 |
| ---- | -------- | --------- | ---------- | --------- | ------------ | --------------- |
| A    | 0.6 s    | 1         | 10         | 10        | 16.7         | 20 (12 s)       |
| B    | 0.8 s    | 1         | 22         | 22        | 27.5         | 20 (16 s)       |
| C    | 1.0 s    | 2         | 40         | 80        | 80.0         | 10 (10 s)       |
| D    | 2.5 s    | 3         | 50         | 150       | 60.0         | 7 (17.5 s)      |

C wins **value per second**; D wins **value per hold unit** but costs travel and cut time. D is a
high-score gamble, not a free upgrade. Cut times exclude travel; transit is separate.

- **Hairline has a fork:** a long safe lane and a short lane that closes once during the return. The
  player can see which one is closing; choosing wrongly is a route mistake, not random geology.
- **Cut-driven return:** cutting a seam destabilises a deterministic neighbouring rock; the cut
  position determines where it drifts. The danger is self-authored. The PB ghost records rock deltas
  so it flies the same world; the 5-day gate has no ghost, so this is free to test there.
- **Jettison has teeth:** dumped chunks become inert colliders and are recorded in the ghost. In the
  5-day gate they are visual-only to keep the mass test clean. The gate corridor itself starts clear.
- No enemies. Pressure is distance, cut-driven drift, the closing shift window and the return band.

### Shipping fields

| Field              | Layout                                                                      | Teaches                               | When  |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------- | ----- |
| **Hairline**       | 36 rocks: A 12, B 14, C 10; C ends at 300 m; hero at 230 m; lanes 20 m/28 m | Cargo mass + the full return distance | 5-day |
| **Twin Arcs**      | A rocks near, B rocks across a 70 m moat                                    | Paying the trip for deeper value      | Core  |
| **Dust Ring**      | 270° ring at 140–200 m, two mouths, ~30 rocks; 12 m gate, 18 m corridor     | Jettison, route discipline            | Core  |
| **Relay Causeway** | 40–60 rocks, A/B/C/D bands, gate at B                                       | Full risk loop; hero layout           | Post  |

Later: Spiral Stair, Vault, Ripsaw, Long Haul, Coldline. No new art; telegraph with density, rock
size, tumble and gate geometry.

### Procedural weekly claims

- Seed derived client-side from the ISO week: `hash("deadweight:v1:" + week)`.
- One authored template + one modifier + one hero feature per week, announced on a claim card with a
  seed code (`DW45-7F3A`) and a thumbnail showing value bands and the homeward lane.
- The generator guarantees a bankable A-band haul, a clear 18 m gate corridor, reachable value
  pockets, seams wider than the hull, and a round trip that fits the shift. Reject and retry until it
  validates; a hand-authored safe fallback covers failures.
- **Drift-safe generation:** no cuttable face sits within **drift + rock radius (~25 m)** of the
  gate centreline; at least two exits remain wider than **2.5× hull** after maximum drift. The
  generator validates the drift-injected field, not just the initial state.
- **Generator versioning:** the seed string includes a generator version; every archived claim stores
  its full field JSON and version, so an old claim never regenerates differently after a code change.
- New players get three fixed onboarding fields before the weekly claim unlocks.

---

## 6. Score and the long game

### A run's score

- Delivered value only. Held cargo is not score until docked.
- Cargo is ordered by load time. Let `u = min(cargo units, 16)`, `v = value of the first 16 loaded
units`, and `o = value of units 17–20`. Then **`score = (1 + 0.5 × u/16) × v + 0.35 × o`**. The
  fill multiplier rises from ×1.0 at empty to ×1.5 at 80%; overflow banks at 0.35×. Mass keeps
  rising above 80%, so the rational turn-home sits around 80–85%, not 100%.
- Overflow is the greed decision: the last few units can still swing a PB if the return is clean,
  but they bank at 0.35× and add the most mass.
- Ranks are thresholds (`D → S`), not power. Par-based medals (`bronze/silver/gold/platinum`) are
  seed-relative and population-independent. Par comes from the median of three authored template
  routes and their safe budget; there is no procedural solver pretending to find one.
- **No clean-bank streak.** No currency, no shop, no power treadmill.
- If a later update adds modules, they must be sidegrades: scanner vs hold, one equipped slot, never
  mass, thrust or melt speed.

### The PB ghost and split ledger

- One ghost per field, recorded from your own best run: quantised pose at 10–15 Hz plus a cargo
  ticker. Store **positions**, not inputs.
- Rock drift is recorded as a compact delta array in the ghost, so the ghost flies the same world
  even though the player's cuts determine where rocks move. The 5-day gate has no ghost, so this is
  not a gate dependency.
- Split ledger: `outbound / fill at turn / return / dock time`, displayed against your PB.
- The post-run card says what happened:
  **“8.1 t banked · turned at 81% · 12 s to spare”** or
  **“matched PB until 62 s, gave it back in band C.”**
- This is the “one more run” engine: a visible rival and a named mistake.

### Persistence

- Best score, best haul, PB ghost, split ledger, medals. All three core fields are available from
  the start; there is no unlock gate.
- Gold splits per band (4 segments × 3 fields) and one clean-line star per field; every run has a
  named target beyond “more tonnes.”
- Weekly claims archive with their boards and your ghost; a missed week costs nothing.
- No daily login, no streak, no energy, no FOMO.

### Mastery techniques

Discovered, not unlocked:

- **Cut-angle ejection** — chunks leave along the laser reflection; cut the far face and the chunk
  flies toward the hatch. Saves tractor time; costs repositioning.
- **Tractor swing** — claim a chunk behind you while outbound and let it follow your route. Hard
  turns drop it past the beam slew limit.
- **Jettison timing** — tap one unit to restore turn response for the gate; hold to dump everything
  in an emergency. The cargo is gone; the run is not.
- **Relay braking** — stabiliser and reverse thrust to arrive at the gate still controllable; the
  heavy ship punishes late braking.

### The first ten runs (post-slice ladder)

The 5-day gate ships one field. The 3-week core slice ships three; **runs 1–3 are the core**. Runs
4–10 are post-launch weekly claims or later fields; they are a roadmap, not promises for the slice.

| Run | Claim         | New idea                                                 |
| --- | ------------- | -------------------------------------------------------- |
| 1   | Hairline      | Cargo mass changes handling                              |
| 2   | Twin Arcs     | Cross a moat for deeper value; read the return band      |
| 3   | Dust Ring     | Jettison at a gate to survive the return                 |
| 4   | Vault         | Take the far hero first, then work back toward the relay |
| 5   | Spiral Stair  | Chain cuts; cut from the far side of your own corridor   |
| 6   | Scar Field    | Precision at full hold; choose which core to abandon     |
| 7   | Ripsaw        | Commit to a line through inward/outward teeth            |
| 8   | Rotated value | Memorised routes fail; read the field, not the band      |
| 9   | Long Haul     | How far into the red band before turning                 |
| 10  | Black run     | All grammar plus your PB ghost; chase the clean line     |

---

## 7. Live service, low ops

**The map is procedural, so the game generates its own weekly content.** The server is optional and
only adds comparison — scores and ghosts. The game must work with the server offline.

### Two tracks

- **Prospect Ladder:** permanent hand-authored fields for mastery and onboarding.
- **Weekly Claim:** a generated field each Monday, with its own board. It is an experimental stress
  test of the grammar, not a replacement for the ladder.

### Weekly rhythm

- Reset **Monday 00:00 UTC**. Best single run on the week's seed, from **up to 5 submitted attempts**
  (best-of-5), not a cumulative grind.
- Days 2–7: chase your PB, split deltas and one unearned medal; #1 ghost if enough players.
- Sunday: medal issued, claim archived. Past claims remain playable with their own boards.
- **No seasons and no cosmetic track at launch.** No battle pass, no daily login, no decay. A missed
  week costs nothing.

### Server (after the core slice)

- **Cloudflare Workers + D1 + R2**, free tier at this scale; ~$5/month ceiling if traffic explodes.
- Endpoints: current week/seed, top scores, score submission, ghost upload/download.
- Anonymous 128-bit device ID; **auto-generated callsigns** (e.g. `Prospect-7F3A`). No custom handles,
  no accounts, email, chat, comments or UGC. This removes the name-moderation surface.
- **Casual, best-effort anti-cheat:** run token, duration/score plausibility, up to 5 submissions per
  player per week with the best one stored, rate limits, manual top-10 review. No replay-verification
  arms race.
- Client derives the seed locally; the API can advertise/correct the week. Offline runs queue and
  submit on next launch; a failed API hides the feature, never the game.
- Ops: ~1–2 hours/month. A weekly cron, a health check and an error alert — not a live-ops team.
- Privacy: random device ID only; no accounts or email; **no IP retention beyond 30 days**; a short
  privacy note and an identity-reset control. Minimal anonymous run events (start/end/score/seed) may
  be stored for aggregate metrics; opt-out available. No PII.

### Server go/no-go

Build the server only if **both** are true:

- the core-slice long-loop test passes (plateau at run 10+, unprompted day-2 return);
- a manually tracked **closed playtest cohort of at least 25 named players** takes part for 4 weeks:
  at least **25 submit a weekly attempt in 3 of 4 weeks**, at least **12 submit 4+ attempts/week**, and
  at least **6 improve a PB in 2+ weeks**. The organizer counts this from a weekly sheet (seed,
  attempts, scores); no server telemetry is assumed.

Otherwise the weekly claim remains a local/seed-code feature and no Worker is deployed.

### Failure is honest

If the board has fewer than 10 submissions, hide the denominator; show rank without a count from 3
submissions (“1st this week”), never “rank 3 of 3.” Show par medals and split deltas.
Ghosts degrade to your own PB, then a par-pace ghost. Seed codes remain shareable without a backend.

---

## 8. Build order

### 5-day feel gate

**In:** scene split first (`FrameContext`, one `worldToScreen`, `ship-collision`), DEADWEIGHT flight
tuning, pure `cargo-math`/`tuningForCargo`, one relay, **one bank**, Hairline field, return band,
partial jettison, run-state, in-place retry, HUD, browser inspection smoke.

**Out:** PB ghost, save, weekly server, economy, modules, second art pipeline, enemies, menus.

**Purpose:** prove that getting heavy feels like loss of control and that players voluntarily turn
home before the hold is full. The gate tests mass and the return decision only.

### 3-week core slice (only if the gate passes)

Target 3 weeks; 2 weeks only if the refactor lands early. Refactor, mass/weight, **one bank**,
**three fields** (Hairline, Twin Arcs, Dust Ring), PB ghost/split ledger, ranks/medals, local save,
weekly seed + preview. No server, no enemy AI, no economy, no permanent upgrades. If the schedule
slips, cut medals and the preview card before cutting the ghost.

### Retention test (after core slice)

Recruit a fresh cohort for the 12+ run/two-day test with PB ghost and split ledger. If the plateau
lands before run 8 or day-2 return is under 30%, stop before live v1. If it passes, run the 4-week
closed playtest cohort in §7 before the server work.

### Live v1 (4–6 focused days, after the retention gate)

Cloudflare Worker + D1 + R2, best-of-5 scoreboard, weekly ghosts, offline queue, privacy note,
feature flag. Do not start while the core slice is slipping; if it exceeds 6 days, ship seed codes
and local boards only.

### Post-launch content

Relay Causeway field, more templates/modifiers, seed/ghost sharing, sidegrades only (no
mass/thrust/melt power), cosmetic insignia. Each added as a content drop, not a weekly obligation.

### Hard stops

- Scene refactor not split by day 2–3 → freeze to the 5-day ARCADE build.
- Full hold not visibly heavy → stop and reshape before adding content.
- Return leg is a straight commute → stop; polish will not fix it.
- No unprompted day-2 return in the long test → ship the demo, do not build live ops.
- Server scope grows past 6 focused days → keep local seed/local board and stop.

---

## 9. Test plan and kill criteria

### 5-day gate

Recruit 6–8 testers; each plays **8–12 runs over two sessions** (the ghost is not in this build, so
this is not the long-loop test).

- Blind A/B: can testers identify empty vs full hold from handling within 30 s?
- Yaw **rate** deficit ≥30% at full hold; braking from a fixed 10 m/s takes ≥30% longer. Yaw
  time-to-90% is not a useful gate (angular drag is mass-invariant today).
- Fill% at bank: spread across 40–100%, not everyone at 100% or everyone at 20%.
- Do players voluntarily turn home before full? Do they jettison or accept a tow?
- Return leg is 18–30% of run time and ≥1.4× the outbound leg; it has real path divergence, not a
  straight reversal.
- Tune the overflow threshold (16 vs 18 units) and overflow multiplier (0.35–0.6×) against the band
  table; pick the pair that produces an interior optimum and varied turn-home fills.

### Core slice: long-loop test

After PB ghost/split ledger/ranks exist:

- Each tester plays **12+ runs across two unobserved sessions on consecutive days**.
- Record the **run index where their score stops improving**. Plateau at run 4–6 means the long game
  is not there; target plateau at run 10+.
- Record unprompted day-2 return.
- Check for quitting **after a win**: if players win then stop, there is no next intention.
- Route diversity: at least two distinct bank routes per field by run 6.
- Fill% mean 70–85%; no single dominant fill value; testers attempt >85% sometimes but not every
  run.
- At least **4 self-terminated runs per session** on both test days, and ≥80% retry within 10 s of
  a tow.

### Kill criteria

Stop or reshape if:

- mass is imperceptible at full hold;
- the return leg is a straight commute;
- the long-loop plateau lands before run 8;
- fewer than 3 of 8 testers return on day 2 unprompted;
- fill% clusters at a single value, or testers stop attempting >85% altogether;
- the core slice still needs more than 3 weeks to reach the test.

**Kill the live layer** if WoW return is below 20% for two weeks, activity collapses to Monday only,
or the board increases retries while shortening sessions.

### What is still unproven

- That a full hold is physically legible without a debuff bar.
- That one bank is enough run structure; three banks remain an experiment, not a promise.
- That a browser arcade can retain players past run 6 without an economy.
- That a weekly procedural claim adds mastery rather than resetting it.
- That the 350 m / 18 m/s scale produces the intended return-leg tension.
- That cut-driven drift reads as a closing world rather than arbitrary geology.

---

## 10. Risks and mitigations

| Risk                              | Why it matters                                 | Mitigation / gate                                                                    |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Mass is imperceptible             | The entire hook depends on it                  | Hard gate: full hold 35–50% hull; blind A/B; retune cargo mass, never thrust         |
| Return leg is a reverse commute   | “Return trip is the level” becomes a countdown | Arc/spiral bands + cut-driven drift; test path divergence, not just turn-home        |
| Greed is negative EV              | Fat hold fantasy contradicts bank-light play   | Overflow banks at 0.35×; mass keeps rising; D slow; tune to 80–85% optimum           |
| Fill is always optimal            | Greed collapses into “hold W and fill”         | Overflow penalty + slow D seams; fill% must not cluster at one value                 |
| Mining is too slow for arcade     | 120 s becomes 80 s of waiting                  | Common seams ~0.6 s; 1–3 chunks per cut; first chunk under 8 s                       |
| Scale is wrong                    | Current field is crossed in seconds            | 350 m radius + ~18 m/s ship; gate on return-leg share before content                 |
| Ghost drifts through rocks        | PB ghost becomes lying theatre                 | Ghost records rock deltas; 5-day gate has no ghost                                   |
| Scene refactor slips              | Two builders blocked in one 987-line tick      | Split by day 2–3 or freeze to 5-day build                                            |
| Live layer built too early        | Backend work eats the core date                | Server only after retention gate; seed codes/local boards first                      |
| Small board looks dead            | “Rank 3 of 3” is worse than no board           | Par medals; hide denominator below 10; show rank from 3 without a count; local board |
| Cheating poisons the weekly board | Client-authoritative scores                    | Casual best-effort validation; no rewards; hide flagged entries                      |
| 3-week scope creep                | Fields, ghost, medals, server all want days    | Fixed slice: one bank, three fields; cut medals/preview before ghost; server later   |

---

## 11. Scope discipline

### Never build for this game

- accounts, password resets or any user-data database;
- custom names, chat, comments, public UGC or a moderation surface we cannot staff;
- daily streaks, login rewards, energy, FOMO, seasons timed to deadlines, or push notifications;
- paid advantage, ads or any “engagement” tuning that mistreats the player;
- replay-verification anti-cheat for a rewardless arcade game;
- enemy AI or a second art pipeline before the core loop earns them;
- a permanent power treadmill that trivialises the mass curve;
- asymmetric cargo or a moving centre of mass. Uniform load only;
- a three-bank chain before the one-bank run is proven;
- collision-changing tailings or drift without ghost-recorded deltas.

The game should feel good to make and good to play. Tension comes from weight, a closing window and a
named mistake — not from manipulating the player.

---

## 12. Rejected ideas (and why)

| Idea                         | Decision                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Arena wave defence           | More expensive; needs enemy AI/art/camera rescale; closer to a generic twin-stick shooter. Fallback only. |
| Shop / permanent upgrades    | Flattens the mass curve — the entire game — and adds a UI layer before the loop is proven.                |
| Bank streak                  | Rewards early banking and trains risk-aversion. Cut.                                                      |
| Exact seconds ETA            | Turns the run into arithmetic; solved in a few runs. Replaced by a lagging return band.                   |
| Asymmetric hold / moving COM | Physics and camera rabbit hole. Uniform load only.                                                        |
| Daily seeded return hook     | Attendance design, not skill design. Weekly claims are variety, not a calendar obligation.                |
| Three banks in the slice     | Not coherent with the clock, band economy or test plan. Post-slice experiment.                            |
| Public handles / UGC         | Moderation surface a two-person team cannot staff. Auto-callsigns only.                                   |
| Seasons / battle pass        | Deadline pressure and scope. No seasons at launch.                                                        |
| “Value surge” weeks          | A multiplier that changes the ceiling, not the decision. Not shipped.                                     |

---

## 13. Open decisions

- Final title and brand lock (`DEADWEIGHT` is a working title).
- Exact DEADWEIGHT flight tuning (18 m/s target) and camera zoom after the scale gate.
- Whether the weekly claim ships at launch or one update after the core slice.
- Whether the weekly board can be paused for a bathroom break without opening a cheat hole.
- Whether the server is ever built, and if so, whether the board is public from day one.
- Exact rank/medal thresholds and par derivation from template budget.
- Pause/settings scope for the first public build; accessibility beyond reduced motion.
- Whether the three-bank chain ever returns as a post-slice mode.

---

## 14. Next step

1. Lock this brief.
2. Build the 5-day feel gate: scene split, DEADWEIGHT tuning, cargo mass, one relay, one bank,
   Hairline, return band, partial jettison, retry, HUD.
3. Run the 8–12-run gate against the mass/return criteria.
4. If it passes, build the 3-week core slice, then run the long-loop and 4-week cohort retention
   tests. Do not start the server or three-bank mode before those pass.

**One-line decision:** _DEADWEIGHT is a one-bank, two-minute skill arcade about greed you can feel in
the stick — large enough to breathe, slow enough to fear, static-first and cheap to operate._
