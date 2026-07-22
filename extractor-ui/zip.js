/*
 * Minimal dependency-free ZIP writer (STORE method, no compression).
 * Shared by the extractor and organizer UI pages. Exposes window.zipStore.
 *
 *   zipStore([{ name: "a/b.json", text: "…" }, …]) -> Blob (application/zip)
 */
(function () {
  "use strict";

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipStore(entries) {
    var enc = new TextEncoder();
    var chunks = []; // local file records
    var central = []; // central directory records
    var offset = 0;
    function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
    function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

    entries.forEach(function (e) {
      var nameBytes = enc.encode(e.name);
      var data = enc.encode(e.text);
      var crc = crc32(data);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameBytes, data);
      var cen = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      );
      central.push(new Uint8Array(cen), nameBytes);
      offset += local.length + nameBytes.length + data.length;
    });

    var centralSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(centralSize), u32(offset), u16(0)
    ));
    return new Blob(chunks.concat(central, [end]), { type: "application/zip" });
  }

  window.zipStore = zipStore;
})();
