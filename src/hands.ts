/**
 * Real hand tracking via the standard WebXR Hand Input API.
 *
 * Reads joint poses from the current XR frame, converts them to world space
 * using the player rig, and derives two stable signals per hand:
 * - open:  fingers spread (palm presented), with hysteresis to avoid flicker
 * - pinch: thumb tip touching index tip, with hysteresis
 * The palm position is smoothed. When tracking drops, `tracked` goes false so
 * gameplay can stop applying forces.
 */

import type { Object3D, WebGLRenderer } from 'three';
import { Vector3 } from 'three';

const TIPS: XRHandJoint[] = [
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
];

// Average fingertip-to-wrist distance, in metres.
const OPEN_ON = 0.14;
const OPEN_OFF = 0.115;
// Thumb tip to index tip distance, in metres.
const PINCH_ON = 0.022;
const PINCH_OFF = 0.04;
const SMOOTHING = 18; // higher = snappier palm smoothing

export interface HandState {
  tracked: boolean;
  open: boolean;
  pinch: boolean;
  palm: Vector3; // smoothed, world space
  pinchPoint: Vector3; // smoothed midpoint of thumb and index tips, world space
}

function newHand(): HandState {
  return { tracked: false, open: false, pinch: false, palm: new Vector3(), pinchPoint: new Vector3() };
}

export class HandReader {
  readonly left = newHand();
  readonly right = newHand();
  private raw = new Vector3();
  private wrist = new Vector3();
  private tip = new Vector3();
  private thumb = new Vector3();
  private hadPalm = { left: false, right: false };

  update(renderer: WebGLRenderer, origin: Object3D, delta: number): void {
    const frame = renderer.xr.isPresenting ? renderer.xr.getFrame() : null;
    const space = renderer.xr.getReferenceSpace();
    let sawLeft = false;
    let sawRight = false;

    if (frame != null && space != null) {
      origin.updateMatrixWorld();
      const session = frame.session;
      for (const source of session.inputSources) {
        const hand = source.hand;
        if (hand == null) continue;
        const side = source.handedness;
        if (side !== 'left' && side !== 'right') continue;
        const state = side === 'left' ? this.left : this.right;
        if (this.read(frame, space, hand, origin, state, side, delta)) {
          if (side === 'left') sawLeft = true;
          else sawRight = true;
        }
      }
    }

    if (!sawLeft) this.lose(this.left, 'left');
    if (!sawRight) this.lose(this.right, 'right');
  }

  private jointWorld(
    frame: XRFrame,
    space: XRReferenceSpace,
    hand: XRHand,
    name: XRHandJoint,
    origin: Object3D,
    out: Vector3,
  ): boolean {
    const joint = hand.get(name);
    if (joint == null || frame.getJointPose == null) return false;
    const pose = frame.getJointPose(joint, space);
    if (pose == null) return false;
    const p = pose.transform.position;
    out.set(p.x, p.y, p.z).applyMatrix4(origin.matrixWorld);
    return true;
  }

  private read(
    frame: XRFrame,
    space: XRReferenceSpace,
    hand: XRHand,
    origin: Object3D,
    state: HandState,
    side: 'left' | 'right',
    delta: number,
  ): boolean {
    if (!this.jointWorld(frame, space, hand, 'middle-finger-metacarpal', origin, this.raw)) {
      return false;
    }
    if (!this.jointWorld(frame, space, hand, 'wrist', origin, this.wrist)) return false;

    // Openness: how far the fingertips are from the wrist on average.
    let sum = 0;
    let count = 0;
    for (const name of TIPS) {
      if (this.jointWorld(frame, space, hand, name, origin, this.tip)) {
        sum += this.tip.distanceTo(this.wrist);
        count += 1;
      }
    }
    const spread = count > 0 ? sum / count : 0;

    let pinchDist = 1;
    let hasPinchPoint = false;
    if (
      this.jointWorld(frame, space, hand, 'thumb-tip', origin, this.thumb) &&
      this.jointWorld(frame, space, hand, 'index-finger-tip', origin, this.tip)
    ) {
      pinchDist = this.thumb.distanceTo(this.tip);
      this.thumb.add(this.tip).multiplyScalar(0.5); // reuse as the pinch point
      hasPinchPoint = true;
    }

    state.pinch = state.pinch ? pinchDist < PINCH_OFF : pinchDist < PINCH_ON;
    const wantsOpen = state.open ? spread > OPEN_OFF : spread > OPEN_ON;
    state.open = wantsOpen && !state.pinch;

    if (!this.hadPalm[side]) {
      state.palm.copy(this.raw);
      if (hasPinchPoint) state.pinchPoint.copy(this.thumb);
    } else {
      const k = 1 - Math.exp(-SMOOTHING * delta);
      state.palm.lerp(this.raw, k);
      if (hasPinchPoint) state.pinchPoint.lerp(this.thumb, k);
    }
    this.hadPalm[side] = true;
    state.tracked = true;
    return true;
  }

  private lose(state: HandState, side: 'left' | 'right'): void {
    state.tracked = false;
    state.open = false;
    state.pinch = false;
    this.hadPalm[side] = false;
  }
}
