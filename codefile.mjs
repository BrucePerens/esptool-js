import { ESPError } from './error.mjs'

class CodeFile {
  blob;
  offset = 0;
  size;
  checksum;
  valid = false;
  overlaps = false;

  static async FromURL(url) {
    let response = await fetch(url);

    if ( response.ok != true ) {
      console.log(response.ok)
      throw new ESPError(`${url}: ${response.statusText}`);
    }
    let blob = await response.blob();
    return new this(blob);
  }

  constructor(b) {
    this.blob = b;
    console.log(`set blob to ${b.constructor.name}`);
  }
};
let c = await CodeFile.FromURL("http://google.com");
console.table(c);
