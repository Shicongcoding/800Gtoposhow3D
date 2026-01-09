import * as THREE from 'three';

export type NodeType = 'spine' | 'leaf' | 'server';

export interface NodeData {
  id: number;
  clusterId?: number; // Spines and Leafs belong to a cluster. Servers might be shared or logically grouped.
  type: NodeType;
  position: THREE.Vector3;
  groupId?: number; // For leafs and servers
  label: string;
}

export interface NetworkLayout {
  spines: NodeData[];
  leafs: NodeData[];
  servers: NodeData[];
}