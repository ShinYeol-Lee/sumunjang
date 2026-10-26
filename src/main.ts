import './ui/styles.css';
import { App } from './ui/app';

const app = new App(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('ui') as HTMLDivElement);
void app.start();
