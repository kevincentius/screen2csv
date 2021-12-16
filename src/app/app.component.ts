import { Component, ElementRef, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { createWorker } from 'tesseract.js';
import { IdbService } from './services/idb.service';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  regex: string;
}

interface Config {
  boxes: Box[];
  scale: number;
  invert: boolean;
  trim: boolean;
  headers: string;
}

interface InputData {
  name: string;
  imgUrl?: string;
  extractedText?: string[];
  parseResult?: string[][];
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  @ViewChild('fileDialogInput') fileDialogInput!: ElementRef<HTMLInputElement>;

  zoomExp = -10;
  zoomBase = 0.95;
  zoom = Math.pow(this.zoomBase, this.zoomExp);

  config: Config = {
    boxes: [
      {
        x: 100,
        y: 200,
        w: 300,
        h: 400,
        regex: '(.*)',
      }
    ],
    scale: 1,
    invert: true,
    trim: true,
    headers: 'file,#,text',
  }

  inputs: InputData[] = [];
  nextScreenshotId = 1;

  selectedInput = 0;
  selectedBox = 0;
  processedCount = 0;

  // csvData: string[][] = [];

  processIsRunning = false;

  boxStartPos: {x: number, y: number} | null = null;
  previewBox: any = null;
  
  constructor(
    private idbService: IdbService,
    private titleService: Title,
  ) {}

  async ngOnInit() {
    document.onpaste = (event: any) => {
      var items = (event.clipboardData || event.originalEvent.clipboardData).items;
      for (var index in items) {
        var item = items[index];
        if (item.kind === 'file') {
          var blob = item.getAsFile();
          var reader = new FileReader();
          reader.onload = (event: any) => {
            if ((event.target.result as string).startsWith('data:image/png')) {
              const inp: InputData = {
                name: 'screenshot_'+this.nextScreenshotId++,
                imgUrl: event.target.result,
              }
              this.addInput(inp);
            }
          };
          reader.readAsDataURL(blob);
        }
      }
    };

    await this.idbService.init();
    const savedConfig = await this.idbService.get('config') as Config | undefined;
    if (savedConfig) {
      this.config = savedConfig;
    }
  }

  async processRemaining() {
    if (this.processIsRunning) {
      return;
    }

    this.processIsRunning = true;

    while (this.processedCount < this.inputs.length) {
      const inp = this.inputs[this.processedCount];

      // process each box
      inp.extractedText = [];
      inp.parseResult = [];
      for (let boxIndex = 0; boxIndex < this.config.boxes.length; boxIndex++) {
        const box = this.config.boxes[boxIndex];

        const worker = createWorker();
        await worker.load();
        await worker.loadLanguage('eng');
        await worker.initialize('eng');

        const { data: { text } } = await worker.recognize(inp.imgUrl!, {
          rectangle: {
            left: box.x * this.config.scale,
            top: box.y * this.config.scale,
            width: box.w * this.config.scale,
            height: box.h * this.config.scale,
          }
        });
        await worker.terminate();
        inp.extractedText.push(text);

        var regexp = new RegExp(box.regex, "g");
        const matches = [...text.matchAll(regexp)];

        const matchesCsv = matches.map(row => [...row]);
        matchesCsv.forEach(match => {
          if (match.join('').trim()) {
            let row = [inp.name, boxIndex.toString(), ...match.slice(1)];
            if (this.config.trim) {
              row = row.map(val => val.trim());
            }
            inp.parseResult = [...inp.parseResult!, row];
          }
        });
      }

      this.processedCount++;
      
      this.updateTitle();
    }

    this.processIsRunning = false;
  }

  onFileChange(files: File[]) {
    this.selectedInput = 0;

    for (let file of files) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (_event) => this.addInput({
        name: file.name,
        imgUrl: reader.result as string,
      });
    }
  }

  async addInput(inputData: InputData) {
    if (this.config.invert) {
      // preprocess image (invert color)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
  
      const imgDataUrl: string = await new Promise((resolve, reject) => {
        img.onload = () => {
          canvas.width = img.width * this.config.scale;
          canvas.height = img.height * this.config.scale;
          ctx.filter = 'invert(1) contrast(200%)';
          ctx.drawImage(img, 0, 0, img.width * this.config.scale, img.height * this.config.scale);
          resolve(canvas.toDataURL());
        }
        img.src = inputData.imgUrl!;
      });
  
      inputData.imgUrl = imgDataUrl;
    }
    
    // push and process
    this.inputs.push(inputData);
    this.selectedInput = this.inputs.length - 1;
    
    this.updateTitle();

    await this.processRemaining();
  }

  async downloadAsCsv() {   
    const csvData = this.inputs.map(inp => inp.parseResult!).flat();
    if (this.config.headers) {
      csvData.unshift(this.config.headers.split(','));
    }
    downloadBlob(arrayToCsv(csvData), 'export.csv', 'text/csv;charset=utf-8;');
  }

  downloadConfig() {
    downloadBlob(JSON.stringify(this.config), 'config.json', 'application/json;charset=utf-8');
  }

  saveConfig() {
    this.idbService.put('config', this.config);
  }

  uploadConfig() {
    console.log(this.fileDialogInput);
    this.fileDialogInput.nativeElement.click();
  }

  onLoadConfig(event: any) {
    const files = (event.target.files as FileList);
    if (files.length === 1) {
      const file = files.item(0)!;
      
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = (_event) => setTimeout(() => {
        this.config = JSON.parse(reader.result as string)
      });
    }
  }

  updateTitle() {
    this.titleService.setTitle(this.processedCount + ' / ' + this.inputs.length);
  }

  onMouseDown(event: MouseEvent) {
    this.boxStartPos = { x: event.offsetX / this.zoom, y: event.offsetY / this.zoom };
  }

  onMouseMove(event: MouseEvent) {
    if (this.boxStartPos) {
      const x1 = Math.min(this.boxStartPos.x, event.offsetX / this.zoom);
      const x2 = Math.max(this.boxStartPos.x, event.offsetX / this.zoom);
      const y1 = Math.min(this.boxStartPos.y, event.offsetY / this.zoom);
      const y2 = Math.max(this.boxStartPos.y, event.offsetY / this.zoom);

      this.previewBox = {
        x: x1,
        y: y1,
        w: x2 - x1,
        h: y2 - y1,
      }
    }
  }

  onMouseUp(event: MouseEvent) {
    if (this.previewBox) {
      setTimeout(() => {
        this.config.boxes[this.selectedBox].x = this.previewBox.x;
        this.config.boxes[this.selectedBox].y = this.previewBox.y;
        this.config.boxes[this.selectedBox].w = this.previewBox.w;
        this.config.boxes[this.selectedBox].h = this.previewBox.h;
  
        this.boxStartPos = null;
        this.previewBox = null;
      });
    }
  }

  recompute() {
    this.inputs.forEach(inp => {
      inp.extractedText = undefined;
      inp.parseResult = undefined;
    });
    this.processedCount = 0;
    this.processRemaining();
  }

  onZoomExpChange(event: any) {
    console.log(event.target.value);
    this.zoomExp = event.target.value;
    this.zoom = Math.pow(0.9, -this.zoomExp);
  }
}

/** Convert a 2D array into a CSV string
 */
function arrayToCsv(data: string[][]) {
  return data.map(row =>
    row
      .map(String)  // convert every value to String
      .map(v => v.replaceAll('"', '""'))  // escape double colons
      .map(v => `"${v}"`)  // quote it
      .join(',')  // comma-separated
  ).join('\r\n');  // rows starting on new lines
}

/** Download contents as a file
 * Source: https://stackoverflow.com/questions/14964035/how-to-export-javascript-array-info-to-csv-on-client-side
 */
function downloadBlob(content: any, filename: string, contentType?: string) {
  // Create a blob
  var blob = new Blob([content], { type: contentType });
  var url = URL.createObjectURL(blob);

  // Create a link to download it
  var pom = document.createElement('a');
  pom.href = url;
  pom.setAttribute('download', filename);
  pom.click();
}