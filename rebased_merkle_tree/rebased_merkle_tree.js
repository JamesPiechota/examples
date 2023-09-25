#!/usr/bin/env node
var fs = require("fs");
var crypto = require("crypto");
var Arweave = require("arweave");
const { default: Transaction } = require("arweave/node/lib/transaction");
const { intToBuffer } = require("arweave/node/lib/merkle");

const MAX_CHUNK_SIZE = 256 * 1024;
const HASH_SIZE = 32;
const REBASE_MARK = new Uint8Array(HASH_SIZE);


var arweave = new Arweave({
  host    : "testnet-3.arweave.net",
  port    : "1984",
  protocol: "http",
  network : "arweave.2.7.testnet"
});

var wallet_path = "/root/wallets/MXeFJwxb4y3vL4In3oJu60tQGXGCzFzWLwBUxnbutdQ_keyfile.json";
var key = JSON.parse(fs.readFileSync(wallet_path));

async function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

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

async function get_rebased_proof(proof, subtree_root1, subtree_root2, subtree_size1) {
  let rounded_size1 = Math.ceil(subtree_size1 / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
  return Arweave.utils.concatBuffers([
    REBASE_MARK,
    subtree_root1,
    subtree_root2,
    intToBuffer(rounded_size1),
    proof
  ]);
}

async function rebase_proof(
  merged_transaction, left_transaction, right_transaction, left_bound_shift, proof, chunk) {
    let rounded_left_size = Math.ceil(left_bound_shift / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
    let rebased_proof = await get_rebased_proof(
      proof.proof,
      left_transaction.chunks.data_root,
      right_transaction.chunks.data_root,
      parseInt(left_transaction.data_size)
    );
    chunk.minByteRange = left_bound_shift + chunk.minByteRange;
    chunk.maxByteRange = left_bound_shift + chunk.maxByteRange;
    merged_transaction.chunks.chunks.push(chunk);
    merged_transaction.chunks.proofs.push({
      proof: rebased_proof,
      offset: rounded_left_size + proof.offset,
    });
}

async function rebase_proofs(merged_transaction, left_transaction, right_transaction) {
  let left_size = parseInt(left_transaction.data_size);
  let right_size = parseInt(right_transaction.data_size);
  let rounded_left_size = Math.ceil(left_size / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
  let tree_size = rounded_left_size + right_size;

  merged_transaction.data = Arweave.utils.concatBuffers([
    left_transaction.data, right_transaction.data]);

  let rebased_proofs = [];
  for (let i = 0; i < left_transaction.chunks.proofs.length; i++) {
    await rebase_proof(merged_transaction, left_transaction, right_transaction, 0,
      left_transaction.chunks.proofs[i], left_transaction.chunks.chunks[i]);
  }
  for (let i = 0; i < right_transaction.chunks.proofs.length; i++) {
    await rebase_proof(merged_transaction, left_transaction, right_transaction, left_size,
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
      console.log("post chunk " + i);
      console.log(payload);
      // let decoder = new TextDecoder('utf-8');
      // let str = decoder.decode(chunk_data);
      // console.log(str);
      console.log(await arweave.api.post('chunk', payload));
  }
}

(async function(){
  // 200 bytes
  const suffix = "01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789";
  let transaction1 = await arweave.createTransaction({
    // data: fs.readFileSync('lorem_524288.txt')
    data: fs.readFileSync('lorem_474000.txt')
  });
  let transaction2 = await arweave.createTransaction({
    //data: fs.readFileSync('lorem_262144.txt')
    data: "hello world1" + suffix
  });

  console.log("transaction1");
  console.log(transaction1);
  console.log(transaction1.chunks);
  console.log("transaction2");
  console.log(transaction2);

  let merged_transaction = await merge_and_rebase_merkle_trees(transaction1, transaction2);
  
  await arweave.transactions.sign(merged_transaction, key);
  console.log("merged_transaction");
  console.log(merged_transaction);
  console.log(await arweave.api.post('tx', merged_transaction));

  await rebase_proofs(merged_transaction, transaction1, transaction2);
  console.log("merged_transaction");
  console.log(merged_transaction);
  console.log(merged_transaction.chunks.chunks);
  console.log(merged_transaction.chunks.proofs);

  await post_chunks(merged_transaction);

  // const proof0 = await get_rebased_proof(
  //   transaction1.chunks.proofs[0].proof,
  //   transaction1.chunks.data_root,
  //   transaction2.chunks.data_root,
  //   parseInt(transaction1.data_size)
  // );
  // const offset0 = await get_rebased_offset(0, transaction1.chunks.proofs[0].offset);
  // const chunk0 = transaction1.chunks.chunks[0];
  // let payload = {
  //   data_root: transaction3.data_root,
  //   data_size: transaction3.data_size,
  //   data_path: Arweave.utils.bufferTob64Url(proof0),
  //   offset: offset0.toString(),
  //   chunk: Arweave.utils.bufferTob64Url(
  //     transaction1.data.slice(chunk0.minByteRange, chunk0.maxByteRange)
  //   ),
  // };
  // console.log(payload);
  // console.log(await arweave.api.post('chunk', payload));


  // let tx_id = transaction3.id;
  // const response = await arweave.api.post('tx', transaction3);
  // console.log(response);

  // let uploader = await arweave.transactions.getUploader(transaction);
  
  // while (!uploader.isComplete) {
  //   await uploader.uploadChunk();
  //   console.log(`${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`);
  // }
  // console.log("Upload completed");
  // console.log("Poll for tx status...");
  // while(true) {
  //   await delay(10000);
  //   try {
  //     let res = await arweave.transactions.getStatus(tx_id);
  //     if (res.confirmed) {
  //       console.log("confirmed ", res.confirmed);
  //       break;
  //     }
  //     console.log("unconfirmed");
  //   } catch(err) {
  //     console.log("error during pool for status (you can ignore it)", err.message);
  //   }
  // }
  // console.log("Poll complete. Tx seems published");
})()



// (async function(){
//   // 200 bytes
//   const suffix = "01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789";
//   let transaction1 = await arweave.createTransaction({
//     data: "hello world1" + suffix,
//   });
//   let transaction2 = await arweave.createTransaction({
//     data: "hello world2" + suffix,
//   });
  
//   // TODO later
//   let transaction = await arweave.createBundledTransaction({
//     txList: [transaction1, transaction2]
//   });
//   await arweave.transactions.sign(transaction, key);
//   // DEBUG
//   // console.log(transaction);
//   // process.exit();
  
//   var txid = transaction.id;
//   console.log("txid: "+txid);
//   console.log("upload started");
//   let uploader = await arweave.transactions.getUploader(transaction);
  
//   while (!uploader.isComplete) {
//     await uploader.uploadChunk();
//     console.log(`${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`);
//   }
//   console.log("Upload completed");
//   console.log("Poll for tx status...");
//   while(true) {
//     await delay(10000);
//     try {
//       var res = await arweave.transactions.getStatus(txid);
//       if (res.confirmed) {
//         console.log("confirmed", res.confirmed);
//         break;
//       }
//       console.log("unconfirmed");
//     } catch(err) {
//       console.log("error during pool for status (you can ignore it)", err.message);
//     }
//   }
//   console.log("Poll complete. Tx seems published");
// })()