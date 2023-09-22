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

(async function(){
  // 200 bytes
  const suffix = "01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789";
  let transaction1 = await arweave.createTransaction({
    data: fs.readFileSync('lorem_524288.txt')
  });
  let transaction2 = await arweave.createTransaction({
    data: "hello world1" + suffix
  });

  console.log(transaction1);
  console.log(transaction1.chunks);
  console.log(transaction2);

  let [ data_root, tree_size ] = await merge_and_rebase_merkle_trees(
    transaction1.chunks.data_root,
    parseInt(transaction1.data_size),
    transaction2.chunks.data_root,
    parseInt(transaction2.data_size)
  );

  let transaction3 = new Transaction({
    last_tx: await arweave.transactions.getTransactionAnchor(),
    reward: await arweave.transactions.getPrice(tree_size),
    data_size: tree_size.toString(),
    data_root: Arweave.utils.bufferTob64Url(data_root)
  });
  await arweave.transactions.sign(transaction3, key);
  console.log(transaction3);
  console.log(await arweave.api.post('tx', transaction3));

  const proof0 = await get_rebased_proof(
    transaction1.chunks.proofs[0].proof,
    transaction1.chunks.data_root,
    transaction2.chunks.data_root,
    parseInt(transaction1.data_size)
  );
  const offset0 = await get_rebased_offset(0, transaction1.chunks.proofs[0].offset);
  const chunk0 = transaction1.chunks.chunks[0];
  let payload = {
    data_root: transaction3.data_root,
    data_size: transaction3.data_size,
    data_path: Arweave.utils.bufferTob64Url(proof0),
    offset: offset0.toString(),
    chunk: Arweave.utils.bufferTob64Url(
      transaction1.data.slice(chunk0.minByteRange, chunk0.maxByteRange)
    ),
  };
  console.log(payload);
  console.log(await arweave.api.post('chunk', payload));


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

async function merge_and_rebase_merkle_trees(data_root1, size1, data_root2, size2) {
  let rounded_size1 = Math.ceil(size1 / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
  let data_root = await Arweave.crypto.hash(Arweave.utils.concatBuffers([
    await Arweave.crypto.hash(data_root1),
    await Arweave.crypto.hash(data_root2),
    await Arweave.crypto.hash(intToBuffer(size1))
  ]));
  return [data_root, rounded_size1 + size2];
}

async function get_rebased_proof(proof, subtree_root1, subtree_root2, subtree_size1) {
  let rounded_size1 = Math.ceil(subtree_size1 / MAX_CHUNK_SIZE) * MAX_CHUNK_SIZE;
  return Arweave.utils.concatBuffers([
    subtree_root1,
    subtree_root2,
    intToBuffer(rounded_size1),
    REBASE_MARK,
    proof
  ]);
}

async function get_rebased_offset(left_bound_shift, chunk_offset) {
  return left_bound_shift + chunk_offset;
}

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