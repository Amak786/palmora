# PALMORA: The Living Silence — Devpost draft

> Draft text for the Meta VR Start Developer Competition 2026 form.
> It describes only what the current build does. Fill the [brackets] yourself.

## Project name
PALMORA: The Living Silence

## Tagline (140 characters max)
A world without a voice. Two hands to bring it back. A hands-only VR world you restore with your palms.

## Track / Division
- Track: Gaming
- Division: New Experience

## Description (about 400 words)

**Inspiration**
Most VR games treat hands as a stand-in for controller buttons. We wanted the hands themselves to be the game: an open palm that calls life toward it, two hands that become a bridge, fingertips that mend what is broken.

**What it does**
PALMORA floats a small, silent world in front of you: two dark islands and a sleeping Heart, suspended in a starry void at seated, arm's-length distance. You bring it back to life in four stages, using only your hands:

1. **Palm of Attraction.** Open your palm and glowing seeds drift into your hand and orbit it. Lower your palm onto the first island to plant them. Three seeds make it bloom with crystal flora and light.
2. **The Living Bridge.** Hold one open palm over each island. A ribbon of energy forms between your hands, and a wisp crosses it to wake the second island. Move your hands and the bridge follows.
3. **Pinch to Weave.** Pinch two broken golden crystals, carry them, and set each into its glowing ring to repair the paths to the Heart.
4. **Two-Hand Resonance.** Cradle the Heart between both palms. Ripples build, faster as your hands come closer, until the Heart awakens and the world reconnects.

**Living Echo:** each seed you gathered returns as a wisp circling the Heart, and each restored stage adds a voice to the music. Poke the golden crystal to play again. No controller is needed at any point.

**How we built it**
Built with Meta's Immersive Web SDK (IWSDK), Three.js and TypeScript, running as WebXR in the Meta Quest Browser. Hand input comes from real joint data via the WebXR Hand Input API: we derive smoothed palm and pinch points, and detect open-palm and pinch gestures with hysteresis so they don't flicker. All art is procedural (low-poly islands, emissive crystals, particle stars), and all sound is synthesized live with the Web Audio API.

**Challenges**
Making gestures feel stable. Tracking noise makes naive thresholds flicker, so every gesture uses separate on and off thresholds plus smoothing, and tracking loss is handled gently (seeds drift home, held crystals stay put).

**What's next**
A third biome, creatures that react to each player's play style, a daily seed arrangement for replay, and adjustable reach and sensitivity for accessibility.

## Links to fill in
- Playable link: [public HTTPS URL after hosting]
- Demo video (under 3 minutes, public): [YouTube or Vimeo URL]
- Target launch date: [your date]
- Team: [name, email, role]
