# Rebased Merkle Trees

Prior to Arweave 2.7 if you wanted to combine the data from 2 different merkle trees you had to rebuild a new merkle tree and merkle proofs from scratch. One common scenario where this comes up is when taking the data chunks from two different transactions and merging them together for use in a single transaction. Starting in Arweave 2.7 you can use Merkle Tree Rebasing to allow merging multiple merkle trees without rebuilding any of them. This document provides an overview of the rebasing logic and format. The rebased_merkle_tree.js provides example javascript code.

## Start with 2 regular merkle trees

**id4** and **id3** are the data roots for two independent merkle trees. **h()** is shorthand for **take the sha256 hash of**

![2 Regular Merkle Trees](https://github.com/JamesPiechota/examples/assets/3465100/d6f458db-9ab3-4133-9761-19dffcbcc34d)

## Merging without rebasing

When merging the two trees without rebasing, the nodes in red need to be recomputed. The main reason for this is that the offsets of the data chunks within the two trees need to be synced up.

**chunk3** is no longer located at offset **0**, it's now been moved until right after **chunk2** at offset **524,288**. Changing this offset forces all nodes above that chunk to be recomputed. In a trivial example like this, the work is small, but in transaction with megabytes of gigabytes of data, the number of hashes to recompute can be material.

![Regular Merkle Tree](https://github.com/JamesPiechota/examples/assets/3465100/ebade590-3199-4c16-937a-688fbf7d9e98)
![Rebased Merkle Tree](https://github.com/JamesPiechota/examples/assets/3465100/5d834af0-84a6-4e6d-b344-444505d85b14)
![Merging a Rebased Merkle Tree](https://github.com/JamesPiechota/examples/assets/3465100/c5768c92-2871-41c4-849a-d80332cb49d5)
