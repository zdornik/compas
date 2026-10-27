import {ContourFieldAnimated} from './ContourFieldAnimated.jsx';
import {ContourFieldStatic} from './ContourFieldStatic.jsx';
import {contourVariant} from './visual-variant.js';

// Both renderers share real data and the measured scene coordinates.
// ?background=static restores the previous renderer without touching records.
export function ContourField(props) {
  const Renderer=contourVariant==='static'?ContourFieldStatic:ContourFieldAnimated;
  return <Renderer {...props}/>;
}
