import { ESPError } from './error.mjs'

const ESP_MAGIC = 0xe9;
const ESP_CHECKSUM_MAGIC = 0xef;

class ESPFileHeader {
  // These are the actual header data, in order of appearance.
  magic;
  numberOfSegments;
  spiFlashMode;
  flashSizeAndFrequency;
  entryPointAddress;
  wpPin;
  wpPinWhenSPIPinsAreSetViaEfuse;
  spiFlashDriveSettings;
  chipID;
  deprecatedMinimalChipRevision;
  minimalChipRevision;
  maximalChipRevision;
  reservedBytes = new Uint8Array(4);
  hashAppended;
  segments = [];

  // These are ancillary data derived from the header.
  valid = false;

  constructor(data) {
    this.magic = data.getUint8(0);
    if (this.magic != ESP_MAGIC) {
      throw new ESPError("This file doen't have a valid magic number for an ESP binary.");
    }
    this.numberOfSegments = data.getUint8(1);
    this.spiFlashMode = data.getUint8(2);
    this.flashSizeAndFrequency = data.getUint8(3);
    this.entryPointAddress = data.getUint32(4);
    this.wpPin = data.getUint8(8);
    // This is stored in 3 bytes.
    this.wpPinWhenSPIPinsAreSetViaEfuse = (data.getUint32(9) >> 8) & 0x00ffffff;
    this.spiFlashDriveSettings = data.getUint16(12);
    this.chipID = data.getUint16(12);
    this.deprecatedMinimalChipRevision = data.getUint16(14);
    // How odd that these would be BCD.
    let major = data.getUint8(15);
    let minor = data.getUint8(16);
    this.minimalChipRevision = major * 100 + minor;
    major = data.getUint8(17);
    minor = data.getUint8(18);
    this.maximalChipRevision = major * 100 + minor;
    for (let i = 0; i < 4; i++) {
      this.reservedBytes[i] = data.getUint8(i + 19);
    }
    this.hashAppended = data.getUint8(23);

    let o = 0;
    for (let i = 0; i < this.numberOfSegments; i++ ) {
      try {
      let offset = data.getUint32(36 + o);
      let size = data.getUint32(40 + o);
      o += (8 + size);
      this.segments.push(new ESPSegmentHeader(offset, size));
      } catch {};
    }

    this.valid = true;
  }
}

class ESPSegmentHeader {
  offset;
  size;
  constructor(offset, size) {
    this.offset = offset;
    this.size = size;
  }
};

class CodeFile {
  data;
  offset = 0;
  size;
  checksum;
  valid = false;
  overlaps = false;
  header;

  static async FromURL(url) {
    let response = await fetch(url);

    if ( response.ok != true ) {
      console.log(response.ok)
      throw new ESPError(`${url}: ${response.statusText}`);
    }
    let buffer = await response.arrayBuffer();
    let data = new DataView(buffer);
     
    return new this(data);
  }

  constructor(d) {
    this.data = d;
    this.size = this.data.byteLength;
    this.header = new ESPFileHeader(this.data);
  }
};
let c = await CodeFile.FromURL("https://perens.com/static/Rigcontrol/firmware/k6bp_rigcontrol.bin");
console.table(c.header.segments);
