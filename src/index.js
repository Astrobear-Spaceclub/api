#!/usr/bin/env node
import express from 'express';
import http from 'http';
import https from 'https';
import filesystem from 'fs';
import cors from 'cors';
import env from 'dotenv';
import ethers from 'ethers';
import apicache from 'apicache';
import crypto from 'crypto';
import compression from "compression";

env.config();

const EthersProvider = new ethers.providers.JsonRpcProvider(process.env.ETHERS_PROVIDER, process.env.NETWORK);
const ReadingContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, JSON.parse(filesystem.readFileSync('abi_'+process.env.network+'.json').toString()), EthersProvider);

const privateKey = filesystem.readFileSync(process.env.SSL_PRIVATE_KEY);
const certificate = filesystem.readFileSync(process.env.SSL_CERT);

const credentials = {key: privateKey, cert: certificate};

const app = express();

apicache.options({
    headerBlacklist:  ['access-control-allow-origin'],
    respectCacheControl: true,
    appendKey: function(request, response) {
        return crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
    }
});

const cache = apicache.middleware;
const onlyStatus200 = (req, res) => res.statusCode === 200;

let corsWhitelist = process.env.CORS_ORIGINS.split(' ');

corsWhitelist.push('https://localhost:' + process.env.HTTPS_PORT);
corsWhitelist.push('https://127.0.0.1:' + process.env.HTTPS_PORT);

app.use(cors({
    origin: corsWhitelist
}));

app.use(express.json());

const shouldCompress = (req, res) => {
    if (req.headers['x-no-compression']) {
        // don't compress responses if this request header is present
        return false;
    }

    // fallback to standard compression
    return compression.filter(req, res);
};

app.use(compression({
    // filter decides if the response should be compressed or not,
    // based on the `shouldCompress` function above
    filter: shouldCompress,
    // threshold is the byte threshold for the response body size
    // before compression is considered, the default is 1kb
    threshold: 0
}));

app.use(function (request, response, next) {
    if (!request.secure) {
        return response.redirect("https://" + request.headers.host.replace(process.env.HTTP_PORT, process.env.HTTPS_PORT) + request.url);
    }

    next();
})

app.options('*', cors());

app.get('/download-nft/:tokenId/:signature', cache('24 hours', onlyStatus200), async function (req, res, next) {
    const tokenId = req.params.tokenId;
    const signature = req.params.signature
    const digest = `Download high resolution file of #${tokenId}`;

    let address = '';

    try {
        address = ethers.utils.verifyMessage(digest, signature);
    } catch (e) {
        res.status(403);
        res.send(`Not owner of NFT #${tokenId}`);
        return;
    }

    const owner = await ReadingContract.ownerOf(tokenId);

    if (address !== owner) {
        res.status(403);
        res.send(`Not owner of NFT #${tokenId}`);
        return;
    }

    const file = `${process.cwd()}/metadata/${tokenId}.jpg`;

    res.download(file);
});

app.get('/', cache('24 hours', onlyStatus200), function (req, res, next) {
    res.send('not what you\'re looking for');
});

// Because of `getAsync()`, this error handling middleware will run.
// `addAsync()` also enables async error handling middleware.
app.use(function (error, req, res, next) {
    res.send(error.message);
});

let httpServer = http.createServer(app);
let httpsServer = https.createServer(credentials, app);

httpServer.listen(process.env.HTTP_PORT);
httpsServer.listen(process.env.HTTPS_PORT);