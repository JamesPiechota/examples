#!/usr/bin/env node
var fs = require("fs");
var Arweave = require("arweave");
const { default: Transaction } = require("arweave/node/lib/transaction");
const { intToBuffer } = require("arweave/node/lib/merkle");

const MAX_CHUNK_SIZE = 256 * 1024;
const HASH_SIZE = 32;
const REBASE_MARK = new Uint8Array(HASH_SIZE);
const HOST = "95.216.19.227";
const PORT = "1984";
const PROTOCOL = "http";
const NETWORK =  "arweave.2.7.testnet";

var arweave = new Arweave({
  host    : HOST,
  port    : PORT,
  protocol: PROTOCOL,
  network : NETWORK
});

var wallet_path = "/root/wallets/MXeFJwxb4y3vL4In3oJu60tQGXGCzFzWLwBUxnbutdQ_keyfile.json";
var key = JSON.parse(fs.readFileSync(wallet_path));

async function merge_and_rebase_merkle_trees(left_transaction, right_transaction) {
  let left_size = parseInt(left_transaction.data_size);
  let right_size = parseInt(right_transaction.data_size);
  let rounded_left_size = Math.ceil(left_size / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
  let tree_size = rounded_left_size + right_size;

  let data_root = await Arweave.crypto.hash(Arweave.utils.concatBuffers([
    await Arweave.crypto.hash(left_transaction.chunks.data_root),
    await Arweave.crypto.hash(right_transaction.chunks.data_root),
    await Arweave.crypto.hash(intToBuffer(rounded_left_size))
  ]));

  return new Transaction({
    last_tx: await arweave.transactions.getTransactionAnchor(),
    reward: await arweave.transactions.getPrice(tree_size),
    data_size: tree_size.toString(),
    data_root: Arweave.utils.bufferTob64Url(data_root),
    chunks: {
      data_root: data_root,
      chunks: [],
      proofs: []
    }
  });
}

async function rebase_proof(
  merged_transaction, left_data_root, right_data_root, left_size, left_bound_shift,
      data_buffer_shift, proof, chunk) {
    let rounded_left_size = Math.ceil(left_size / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
    
    let rebased_proof = Arweave.utils.concatBuffers([
      REBASE_MARK,
      left_data_root,
      right_data_root,
      intToBuffer(rounded_left_size),
      proof.proof
    ]);

    chunk.minByteRange = data_buffer_shift + chunk.minByteRange;
    chunk.maxByteRange = data_buffer_shift + chunk.maxByteRange;
    merged_transaction.chunks.chunks.push(chunk);
    merged_transaction.chunks.proofs.push({
      proof: rebased_proof,
      offset: left_bound_shift + proof.offset,
    });
}

async function rebase_proofs(merged_transaction, left_transaction, right_transaction) {
  merged_transaction.data = Arweave.utils.concatBuffers([
    left_transaction.data, right_transaction.data]);

  let left_data_root = left_transaction.chunks.data_root;
  let right_data_root = right_transaction.chunks.data_root;
  let left_size = parseInt(left_transaction.data_size);

  for (let i = 0; i < left_transaction.chunks.proofs.length; i++) {
    let left_bound_shift = 0;
    let data_buffer_shift = 0;
    await rebase_proof(merged_transaction,
      left_data_root, right_data_root,
      left_size, left_bound_shift, data_buffer_shift,
      left_transaction.chunks.proofs[i], left_transaction.chunks.chunks[i]);
  }
  for (let i = 0; i < right_transaction.chunks.proofs.length; i++) {
    let left_bound_shift = Math.ceil(left_size / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
    let data_buffer_shift = left_transaction.data.byteLength;
    await rebase_proof(merged_transaction,
      left_data_root, right_data_root,
      left_size, left_bound_shift, data_buffer_shift,
      right_transaction.chunks.proofs[i], right_transaction.chunks.chunks[i]);
  }
}

async function post_chunks(transaction) {
  for (let i = 0; i < transaction.chunks.chunks.length; i++) {
    let proof = transaction.chunks.proofs[i].proof;
    let offset = transaction.chunks.proofs[i].offset;
    let chunk = transaction.chunks.chunks[i];
    let chunk_data = transaction.data.slice(chunk.minByteRange, chunk.maxByteRange);
    let payload = {
        data_root: transaction.data_root,
        data_size: transaction.data_size,
        data_path: Arweave.utils.bufferTob64Url(proof),
        offset: offset.toString(),
        chunk: Arweave.utils.bufferTob64Url(chunk_data),
      };
     let response = await arweave.api.post('chunk', payload);
     console.log("POST chunk " + i + ": " + response.status);
  }
}

(async function(){
  let transaction1 = await arweave.createTransaction({
    data: fs.readFileSync('lorem_474000.txt')
  });
  let transaction2 = await arweave.createTransaction({
    data: fs.readFileSync('lorem_120000.txt')
  });
  let transaction3 = await arweave.createTransaction({
    data: fs.readFileSync('lorem_524288.txt')
  });

  let merged_transaction1 = await merge_and_rebase_merkle_trees(transaction1, transaction2);
  await rebase_proofs(merged_transaction1, transaction1, transaction2);

  let merged_transaction2 = await merge_and_rebase_merkle_trees(merged_transaction1, transaction3);
  await arweave.transactions.sign(merged_transaction2, key);
  let response = await arweave.api.post('tx', merged_transaction2);
  console.log("POST tx " + merged_transaction2.id + ": " + response.status);

  await rebase_proofs(merged_transaction2, merged_transaction1, transaction3);
  await post_chunks(merged_transaction2);

  console.log(PROTOCOL + "://" + HOST + ":" + PORT + "/tx/" + merged_transaction2.id);
})()

