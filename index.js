// Import all of the modules that are defined in the importmap.
import 'bootstrap';
import 'error';
import { ESPLoader } from 'ESPLoader';
import 'jquery';
import 'pako';
import { Transport } from 'webserial';
import 'xterm';
import 'xterm-addon-fit';
import 'xterm-addon-web-links';

export { showConnectPage, showConsolePage, showProgramPage };

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

// Attach to all of the necessary elements in the HTML document.
const doc = {};
[
  "addFileButton",
  "connectButton",
  "connectPage",
  "connectingPage",
  "consolePage",
  "deviceName",
  "disconnectButton",
  "eraseButton",
  "fileTable",
  "goToProgrammingPageButton",
  "programButton",
  "programPage",
  "programmingBaudrates",
  "resetButton",
  "romBaudrates",
  "terminal"
].forEach(e => { doc[e] = document.getElementById(e) });

// These would otherwise be global variables.
const ctx = {
  "chip": null,
  "device": null,
  "esploader": null,
  "fitAddon": new FitAddon.FitAddon(), // Not a proper ES6 module for the Browser.
  "pollSerialInterval": null,
  "term": new Terminal({ "cursorBlink": true, "cols": 80, "rows": 50 }),
  "transport": null,
  "webLinksAddon": new WebLinksAddon.WebLinksAddon() // Also not proper ES6 module.
};


// Set up the console terminal.
ctx.term.loadAddon(ctx.fitAddon);
ctx.term.loadAddon(ctx.webLinksAddon);
ctx.term.open(doc.terminal);
ctx.fitAddon.fit();

// Wire up all of the buttons.
doc.addFileButton.onclick = doAddFile;
doc.connectButton.onclick = doConnect;
doc.disconnectButton.onclick = doDisconnect;
doc.eraseButton.onclick = doErase;
doc.goToProgrammingPageButton.onclick = showProgramPage;
doc.programButton.onclick = doProgram;
doc.resetButton.onclick = doReset;

// Attempt to close an open serial device before unloading the page, because
// the browser sometimes seems to leave it open, and then we can't open the
// device again.
addEventListener('beforeunload', cleanUp);
addEventListener('unload', cleanUp);

doAddFile();

// Add a file to the list of files to be programmed.
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

// Connect to an ESP device.
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
    ctx.device.addEventListener('disconnect', showConnectPage);
    navigator.serial.addEventListener('disconnect', showConnectPage);
    showConsolePage();
    ctx.esploader = new ESPLoader(ctx.transport, doc.programmingBaudrates.value, ctx.term);

    ctx.chip = await ctx.esploader.main_fn();

    // Temporarily broken
    // await ctx.esploader.flash_id();

    console.log("Settings done for :" + ctx.chip);
    doc.deviceName.innerHTML = ctx.chip;

    await _sleep(100);
    pollSerialStart();
    ctx.esploader.console_mode();
    pollSerialStart();
  } catch(e) {
    console.error(e);
    ctx.term.writeln(`Error: ${e.message}`);
    cleanUp();
    return;
  }
}


// Erase the FLASH of an ESP device.
async function doErase() {
  await lockSerialIO(async lock => {
    doc.eraseButton.disabled = true;

    try{
      await ctx.esploader.program_mode();
      await ctx.esploader.erase_flash();
    } catch (e) {
      console.error(e);
      ctx.term.writeln(`Error: ${e.message}`);
    } finally {
      doc.eraseButton.disabled = false;
    }
  });
}

// Reset the ESP device.
async function doReset() {
  await lockSerialIO(async lock => {
    await ctx.esploader.console_mode();
    await ctx.esploader.hard_reset();
  });
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

// Lock the serial I/O, so that pollSerial doesn't run when a programming function
// is running.
async function lockSerialIO(func) {
  console.log("Lock");
  // Returns a promise.
  return navigator.locks.request('serialOperation', func)
}

// Display serial input on the console.
function pollSerialStart() {
  if (!ctx.pollSerialInterval) {
  ctx.pollSerialInterval = setInterval(pollSerial, 100);
  }
}

// Stop displaying serial input on the console.
function pollSerialStop() {
  if (ctx.pollSerialInterval) {
  clearInterval(ctx.pollSerialInterval);
  ctx.pollSerialInterval = null;
  }
}

// Called every 1/10 second, this looks for serial input and if found, displays it on
// the console.
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

function removeRow(row) {
  const rowIndex = Array.from(doc.fileTable.rows).indexOf(row);
  doc.fileTable.deleteRow(rowIndex);
}

// There are three pages to the program: Connect, Console, and Program.
// These methods show one or the other.
//
// The page used to connect to an ESP device.
function showConnectPage() {
  cleanUp();
  doc.connectPage.style.display = "block";
  doc.consolePage.style.display = "none";
  doc.programPage.style.display = "none";
}

// The page for the serial console.
function showConsolePage() {
  doc.connectPage.style.display = "none";
  doc.programPage.style.display = "none";
  doc.consolePage.style.display = "block";
}

// The page for programming and erasing the ESP, it also shows information about the
// chip.
function showProgramPage() {
  pollSerialStop();
  doc.connectPage.style.display = "none";
  doc.consolePage.style.display = "none";
  doc.programPage.style.display = "block";
  ctx.esploader.program_mode();
  doc.body.style.display = "block";
}

// Sleep for the given number of milliseconds.
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// When the device is disconnected, clean up any stale references and get it ready
// to connect again.
async function cleanUp() {
  if (ctx.device) {
    console.log("Disconnected.");
    ctx.term.writeln("Disconnected.");
    pollSerialStop();
    await ctx.transport.disconnect();
    try {
      await ctx.device.forget();
    } catch {};
    ctx.device = null;
    ctx.transport = null;
    ctx.chip = null;
  }
}

async function doDisconnect() {
  if(ctx.transport) {
    await ctx.transport.disconnect();
  }
  ctx.term.clear();
  showConnectPage();
};

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
