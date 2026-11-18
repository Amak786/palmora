# PALMORA: The Living Silence

*A world without a voice. Two hands to bring it back.*

A seated, hands-only VR game for Meta Quest, built for the Meta VR Start Developer
Competition 2026 (Gaming track, New Experience). It runs as WebXR in the Meta Quest
Browser and is built with Meta's Immersive Web SDK (IWSDK).

## How to play (hands only, no controllers)

| Stage | Gesture | What happens |
| --- | --- | --- |
| 1. Palm of Attraction | Open your palm near the glowing seeds | Seeds drift into your hand and orbit it |
| | Lower your open palm onto the teal island | Seeds sink in. Three make the island bloom |
| 2. The Living Bridge | Hold one open palm over each island | An energy bridge forms between your hands and a wisp crosses it, waking the violet island |
| 3. Pinch to Weave | Pinch a golden crystal, carry it, release it in its ring | Each crystal locks in and repairs a light path to the Heart |
| 4. Two-Hand Resonance | Cradle the Heart between both open palms | Ripples build (closer hands resonate faster) and the Heart awakens |
| Replay | Poke the golden crystal below the world | Restarts |

**Living Echo:** every seed you gather becomes a wisp circling the awakened Heart, and
each restored stage adds a layer to the music.

If tracking is lost, held seeds drift home, held crystals stay where they are, bridge and
resonance pause, and a "Show your hands" hint appears.

## Run locally

Requires Node.js 20.19+ (or 22.12+ / 24+).

```bash
npm install
npm run build
npx vite preview
```

`npm run dev` uses the IWSDK dev runtime, which failed to start on this Windows machine
(`RuntimeOwnerError`), so testing here used the production build served locally.

To test on a Quest, host the `dist/` folder over HTTPS (for example GitHub Pages) and open
the link in the Meta Quest Browser.

## Architecture (`src/`)

| File | Responsibility |
| --- | --- |
| `hands.ts` | Reads real hand joints through the WebXR Hand Input API. Derives smoothed palm and pinch points, open-palm and pinch states with hysteresis, and tracking loss |
| `palmora-game.ts` | Game state and all four stages: seeds, islands, bridge, crystals, Heart, Living Echo, hints |
| `audio.ts` | Synthesized soundscape: layered drone that grows with restoration, feedback tones, chords. No audio files |
| `palmora-components.ts` | ECS component for the poke-able replay crystal |
| `index.ts` | Registers the game and the Enter VR panel |
| `public/scenes/main.iwsdk.scene.json` | Scene: Enter VR panel and lights |

## QA checklist

Legend: **Tested** = verified here. **Simulated** = verified with the built-in test
simulator (`?debug` in the URL drives fake hand positions; it is not real hand tracking).
**Untested** = needs a Quest headset.

| Check | Status |
| --- | --- |
| TypeScript compiles, production build succeeds | Tested |
| Page loads with no errors (desktop browser) | Tested |
| Dark scene, islands, Heart, seeds, stars render | Tested (screenshot) |
| Seeds attract to an open palm and orbit it | Simulated |
| Three seeds bloom island A | Simulated |
| Bridge forms between two open palms; wisp crosses only when anchored | Simulated |
| Pinch grabs a crystal; release in socket locks it | Simulated |
| Cradling the Heart fills resonance and triggers the ending | Simulated |
| Restart returns to a valid initial state | Simulated |
| Enter VR works on Meta Quest Browser | **Untested** |
| Real hand tracking: open-palm and pinch thresholds feel right | **Untested** |
| All interactions reachable while seated | **Untested** |
| Frame rate on Quest | **Untested** |

## Demo video plan (under 3 minutes)

1. **0:00–0:15** Dark void. Raise an open hand; seeds glide into the palm. No text.
2. **0:15–0:45** Lower the palm onto the teal island three times; it blooms with a chord.
3. **0:45–1:15** Both hands out, one over each island. The bridge appears, the wisp crosses, the violet island wakes.
4. **1:15–1:45** Pinch a golden crystal, carry it, set it in its ring. Repeat.
5. **1:45–2:20** Cradle the Heart. Ripples build and it awakens: light threads, circling wisps, full music.
6. **2:20–2:45** Pull back to show the restored world. Title card: "PALMORA: The Living Silence".

Record in the headset (Quest screen recording) so judges see real hands.

## Submission checklist

- [ ] Host `dist/` publicly over HTTPS and confirm it opens on a Quest
- [ ] Test every stage with real hands and adjust thresholds if needed
- [ ] Record and upload the video publicly (YouTube or Vimeo)
- [ ] Fill the Devpost form (draft text in `SUBMISSION.md`)
- [ ] Submit before Nov 18, 2026, 12:00pm PST
