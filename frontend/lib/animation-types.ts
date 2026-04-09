import * as THREE from "three";

export type RotationAxis = "x" | "y" | "z";

export interface JointDefinition {
  id: string;
  partId: string;
  partName: string;
  axis: RotationAxis;
  pivot: THREE.Vector3;
  minAngle: number; // degrees
  maxAngle: number; // degrees
  currentAngle: number; // degrees
  parentJointId: string | null; // for kinematic chains
}

export interface PartData {
  id: string;
  name: string;
  meshIndex: number;
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry | null;
  color: [number, number, number];
  center: THREE.Vector3;
  boundingBox: THREE.Box3;
}

export interface AnimationState {
  joints: JointDefinition[];
  selectedPartId: string | null;
  isConfiguring: boolean;
}

export function getAxisVector(axis: RotationAxis): THREE.Vector3 {
  switch (axis) {
    case "x":
      return new THREE.Vector3(1, 0, 0);
    case "y":
      return new THREE.Vector3(0, 1, 0);
    case "z":
      return new THREE.Vector3(0, 0, 1);
  }
}

export function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export function radiansToDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}
