// Just a few supporting functions to reduce code redundancy
const fs = require("fs");
const softVersion = 3;
var clients = [];

// Handles old AO1.X "encryption"
function fantaDecrypt(data) {
    var bytes = Buffer.from(data, "hex");
    if (bytes.length == 1 || bytes.length != (data.length / 2)) // Shitty heuristic, this will return the input if the input isnt all hex characters
        return data; // This allows "detection" of encrypted packets
    key = 5; // fantacrypt constant
    var cleartext = "";
    bytes.forEach((byte) => {
        cleartext += String.fromCharCode(byte ^ ((key & 0xFFFF) >> 8));
        key = ((byte + key) * 53761) + 32618 // more fantacrypt constants
    });
    return cleartext;
}

// Returns if a socket is connected or not
function isConnected(socketName) {
    clients.forEach((client) => {
        if (client.name === socketName)
            return true;
    });
    return false;
}

// Send a FantaPacket to every client (within a room)
function broadcast(header, data, room) {
    clients.forEach((client) => {
        if (client.name == undefined)
            return;
        if (client.room == room) {
            send(client.socket, header, data, client.websocket);
        }
    });
}

// Turns a header and array into a FantaPacket
function packetBuilder(header, packetContents) {
    var packet = header + "#";
    packetContents.forEach((datum) => {
        packet += datum.toString() + "#";
    });
    packet += "%";
    return packet;
}

// Send a FantaPacket to a client
// The ws arg is super important!
// It determines whether WebSocket encoding is used
function send(socket, header, data, ws) {
    if(ws === undefined){
        console.error("Send called without ws arg!!");
        console.error("If you are reading this contact gameboyprinter#0000 on discord and send him everything you see below");
        console.trace();
        return;
    }
    if (ws) {
        data = packetBuilder(header, data);
        var frame = [];
        frame.push(0x81); // text opcode
        if (data.length < 126)
            frame.push(data.length & 0x7F);
        else { // TODO: implement 64 bit length
            frame.push(126);
            frame.push((data.length & 0xFF00) >> 8);
            frame.push((data.length & 0xFF));
        }
        for (var i = 0; i < data.length; i++) {
            frame.push(data.charCodeAt(i));
        }
        socket.write(Buffer.from(frame));
    } else {
        socket.write(packetBuilder(header, data));
    }
}

// Disconnects a client
function cleanup(client, protocol) {
    if (protocol.rooms[client.room].taken[client.char])
        protocol.players--;
    protocol.rooms[client.room].taken[client.char] = 0;
    clients[client.id] = {};
}

// Removes WebSocket encoding
function decodeWs(data, socket) {
    var payloadLength = 0;
    var opcode = data[0] & 0xF;
    var masked = (data[1] & 0x80) == 0x80;
    var len = data[1] & 0x7F;
    var maskPtr = 0;
    if (opcode == 1) {
        if (len <= 125) {
            payloadLength = len;
            maskPtr = 2;
        } else if (len == 126) {
            payloadLength = (data[2] << 8) | data[3];
            maskPtr = 4;
        } else if (len == 127) {
            payloadLength = (data[2] << 56) | (data[3] << 48) | (data[4] << 40) | (data[5] << 32) | (data[6] << 24) | (data[7] << 16) | (data[8] << 8) | data[9];
            maskPtr = 10;
        }
        var key = [data[maskPtr], data[maskPtr + 1], data[maskPtr + 2], data[maskPtr + 3]];
        maskPtr += 4;
        var unmasked = [payloadLength];
        for (var i = 0; i < payloadLength; i++) {
            unmasked[i] = data[i + maskPtr] ^ key[i % 4];
        }
        var content = Buffer.from(unmasked).toString("utf8");
        return content;
    } else if (opcode == 9) {
        data[0] = (data[0] & 0xF0) || 0xA;
        socket.write(data);
        return;
    } else
        return;
}

// Ban a player, update the config
function ban(client, config) {
    send(client.socket, "KB", [client.char], client.websocket);
    client.socket.end();
    config.bans.push({
        ip: client.socket.remoteAddress,
        hwid: client.hardware
    });
    fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
}

module.exports = {
    fantaDecrypt: fantaDecrypt,
    isConnected: isConnected,
    broadcast: broadcast,
    send: send,
    cleanup: cleanup,
    decodeWs: decodeWs,
    ban: ban,
    softVersion: softVersion,
    packetBuilder: packetBuilder,
    clients: clients
};