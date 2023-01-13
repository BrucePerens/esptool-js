// Import all of the modules that are defined in the importmap.
import 'bootstrap'
import 'error'
import 'ESPLoader'
import 'jquery'
import 'pako'
import 'webserial'
import 'xterm';
import 'xterm-addon-fit';
import 'xterm-addon-web-links';

// Attach to all of the necessary elements in the HTML document.
const doc = {};
[
  "connectButton",
  "connectPage",
  "consolePage",
  "deviceName",
  "disconnectButton",
  "eraseButton",
  "fileTable",
  "programButton",
  "programPage",
  "programmingBaudrates",
  "resetButton",
  "romBaudrates",
  "terminal"
].forEach(e => { doc[e] = document.getElementById(e) });

const ctx = {
  "chip": null,
  "device": null,
  "esploader": null,
  "fitAddon": new FitAddon.FitAddon(), // Not a proper ES6 module for the Browser.
  "pollSerialInterval": null,
  "term": new Terminal(),
  "transport": null,
  "webLinksAddon": new WebLinksAddon.WebLinksAddon() // Also not proper ES6 module.
};

// Check that the required APIs are available.
if (typeof SerialPort == "undefined" || typeof navigator.locks == "undefined") {
  document.open();
  document.write(`
   <html><body>
   <p>Sorry, this browser version doesn't have the required APIs. Please try a newer
   version. A current version of Chrome should work (except perhaps on iOS). 
   </body><html>`);
  document.close();
}

// Set up the console terminal.
ctx.term.loadAddon(ctx.fitAddon);
ctx.term.loadAddon(ctx.webLinksAddon);
ctx.term.open(doc.terminal);
ctx.fitAddon.fit();

function convertUint8ArrayToBinaryString(u8Array) {
  var len = u8Array.length, b_str = "";
  for (var i=0; i<len; i++) {
    b_str += String.fromCharCode(u8Array[i]);
  }
  return b_str;
}

function convertBinaryStringToUint8Array(bStr) {
  var i, len = bStr.length, u8_array = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    u8_array[i] = bStr.charCodeAt(i);
  }
  return u8_array;
}

function handleFileSelect(evt) {
  var file = evt.target.files[0];

  if (!file) return;

  var reader = new FileReader();

  reader.onload = (function(theFile) {
    return function(e) {
      let file1 = e.target.result;
      evt.target.data = file1;
    };
  })(file);

  reader.readAsBinaryString(file);
}

async function lockSerialIO(func) {
  console.log("Lock");
  // Returns a promise.
  return navigator.locks.request('serialOperation', func)
}

function pollSerialStart() {
  if (!ctx.pollSerialInterval) {
  ctx.pollSerialInterval = setInterval(pollSerial, 100);
  }
}

function pollSerialStop() {
  if (ctx.pollSerialInterval) {
  clearInterval(ctx.pollSerialInterval);
  ctx.pollSerialInterval = null;
  }
}

async function pollSerial(e)
{
  return await navigator.locks.request('serialOperation', {ifAvailable: true}, async lock => {
    if (!lock) {
      return;
    }
    if (ctx.pollSerialInterval) {
      if (ctx.device.readable) {
        try {
          let val = await ctx.transport.rawRead({timeout: 1});
          if (typeof val !== 'undefined') {
            ctx.term.write(val);
          }
        } catch (e) {
          if (e.constructor.name != "TimeoutError") {
            console.error(e);
          }
        }
      }
      else {
        console.log("device wasn't readable");
        cleanUp();
      }
    }
  });
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function doConnect() {
  const options = {
    filters: [
    // This is the vendor and product ID for generic CP2102 serial-to-USB adapter
    // chips, and matches the ESP32 Audio Kit. Although Silicon Labs will sell unique
    // USB product IDs to customers, one is not used for the ESP32 Audio Kit.
    // The physical chip is probably a Chinese CP201 clone, rather than the Silicon
    // Labs one.
    //
    // Because the CP201 USB ID is so generic, this will also attach all manner
    // of IoT and Arduino devices.
    { usbVendorId: 0x10c4, usbProductId: 0xea60 }
    ]
  };
  try {
    ctx.device = await navigator.serial.requestPort(options);
    ctx.transport = new Transport(ctx.device);
    ctx.device.addEventListener('disconnect', cleanUp);
    navigator.serial.addEventListener('disconnect', cleanUp);
    ctx.esploader = new ESPLoader(ctx.transport, doc.programmingBaudrates.value, ctx.term);

    ctx.chip = await esploader.main_fn();

    // Temporarily broken
    // await esploader.flash_id();

    console.log("Settings done for :" + ctx.chip);
    doc.deviceName.innerHTML = ctx.chip;
    connectButton.style.display = "none";

    await _sleep(100);
    pollSerialStart();
    esploader.console_mode();
  } catch(e) {
    console.error(e);
    ctx.term.writeln(`Error: ${e.message}`);
    cleanUp();
    return;
  }
}
doc.connectButton.onclick = doConnect;

async function doReset() {
  await lockSerialIO(async lock => {
    await esploader.console_mode();
    await esploader.hard_reset();
  });
}
doc.resetButton.onclick = doReset;

async function doErase() {
  await lockSerialIO(async lock => {
    doc.eraseButton.disabled = true;

    try{
      await esploader.program_mode();
      await esploader.erase_flash();
    } catch (e) {
      console.error(e);
      ctx.term.writeln(`Error: ${e.message}`);
    } finally {
      doc.eraseButton.disabled = false;
    }
  });
}
doc.eraseButton.onclick = doErase;

function doAddFile() {
  var rowCount = doc.fileTable.rows.length;
  var row = doc.fileTable.insertRow(rowCount);
  
  //Column 1 - Offset
  var cell1 = row.insertCell(0);
  var element1 = document.createElement("input");
  element1.type = "text";
  element1.id = "offset" + rowCount;
  element1.value = '0x1000';
  cell1.appendChild(element1);
  
  // Column 2 - File selector
  var cell2 = row.insertCell(1);
  var element2 = document.createElement("input");
  element2.type = "file";
  element2.id = "selectFile" + rowCount;
  element2.name = "selected_File" + rowCount;
  element2.addEventListener('change', handleFileSelect, false);
  cell2.appendChild(element2);
  
  // Column 3  - Progress
  var cell3 = row.insertCell(2);
  cell3.classList.add("progress-cell");
  cell3.style.display = 'none'
  cell3.innerHTML = `<progress value="0" max="100"></progress>`;

  // Column 4  - Remove File
  var cell4 = row.insertCell(3);
  cell4.classList.add('action-cell');
  if (rowCount > 1) {
    var element4 = document.createElement("input");
    element4.type = "button";
    var btnName = "button" + rowCount;
    element4.name = btnName;
    element4.setAttribute('class', "btn");
    element4.setAttribute('value', 'Remove'); // or element1.value = "button";
    element4.onclick = function() {
        removeRow(row);
    }
    cell4.appendChild(element4);
  }
}
addFileButton.onclick = doAddFile;

function removeRow(row) {
  const rowIndex = Array.from(doc.fileTable.rows).indexOf(row);
  doc.fileTable.deleteRow(rowIndex);
}

// to be called on disconnect - remove any stale references of older connections if any
function cleanUp() {
  if (ctx.device) {
    console.log("Disconnected.");
    ctx.term.writeln("Disconnected.");
    pollSerialStop();
    ctx.transport.disconnect();
    try {
      ctx.device.forget();
    } catch {};
    ctx.device = null;
    ctx.transport = null;
    ctx.chip = null;
  }
}

async function doDisconnect() {
  if(ctx.transport)
    await ctx.transport.disconnect();

  ctx.term.clear();
  cleanUp();
};
doc.disconnectButton.onclick = doDisconnect;

function validate_program_inputs() {
  let offsetArr = []
  var rowCount = doc.fileTable.rows.length;
  var row;
  let offset = 0;
  let fileData = null;
 
  // check for mandatory fields
  for (let index = 1; index < rowCount; index ++) {
    row = doc.fileTable.rows[index];

    //offset fields checks
    var offSetObj = row.cells[0].childNodes[0];
    offset = parseInt(offSetObj.value);

    // Non-numeric or blank offset
    if (Number.isNaN(offset))
      return "Offset field in row " + index + " is not a valid address!"
    // Repeated offset used
    else if (offsetArr.includes(offset))
      return "Offset field in row " + index + " is already in use!";
    else
      offsetArr.push(offset);

    var fileObj = row.cells[1].childNodes[0];
    fileData = fileObj.data;
    if (fileData == null)
      return "No file selected for row " + index + "!";

  }
  return "success"
}

async function doProgram() {
  await lockSerialIO(async lock => {
    const err = validate_program_inputs();
  
    if (err != "success") {
      alert(err);
      return;
    }
  
    const fileArray = [];
    const progressBars = [];
  
    for (let index = 1; index < doc.fileTable.rows.length; index++) {
      const row = doc.fileTable.rows[index];
  
      const offSetObj = row.cells[0].childNodes[0];
      const offset = parseInt(offSetObj.value);
  
      const fileObj = row.cells[1].childNodes[0];
      const progressBar = row.cells[2].childNodes[0];
  
      progressBar.value = 0;
      progressBars.push(progressBar);
  
      row.cells[2].style.display = "initial";
      row.cells[3].style.display = "none";
  
      fileArray.push({data:fileObj.data, address:offset});
    }
  
    try {
      await esploader.program_mode();
      await esploader.write_flash({
        fileArray,
        flash_size: 'keep',
        reportProgress(fileIndex, written, total) {
          progressBars[fileIndex].value = written / total * 100;
        },
        calculateMD5Hash: (image) => CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image)),
      });
    } catch (e) {
      console.error(e);
      ctx.term.writeln(`Error: ${e.message}`);
    } finally {
      // Hide progress bars and show erase buttons
      for (let index = 1; index < doc.fileTable.rows.length; index++) {
        doc.fileTable.rows[index].cells[2].style.display = "none";
        doc.fileTable.rows[index].cells[3].style.display = "initial";
      }
      await esploader.console_mode();
    }
  });
}
doc.programButton.onclick = doProgram;

// Attempt to close an open serial device before unloading the page, because
// the browser sometimes seems to leave it open, and then we can't open the
// device again.
addEventListener('beforeunload', cleanUp);
addEventListener('unload', cleanUp);

doAddFile();
