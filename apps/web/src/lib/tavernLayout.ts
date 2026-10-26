import { tableLayout, seatAngles, type TableLayout } from './seats';
/** Spacious, fixed seats. Card ownership stays legible even on eight-player mobile tables. */
export function tavernLayout(opponents: number, size: {width:number;height:number}): TableLayout {
  const l=tableLayout(opponents,size), width=size.width||390, height=size.height||(opponents>4?590:470);
  const rx=Math.max(90,width/2-12), ry=Math.max(90,height/2-20);
  const top=58, bottom=height-110, cy=(top+bottom)/2;
  const plaqueW=opponents>4?74:86, plaqueH=74;
  const seatRx=Math.max(45,width/2-plaqueW/2-6), seatRy=(bottom-top)/2;
  return {...l,cx:width/2,cy:height/2-10,rx,ry,feltRx:rx-22,feltRy:ry-22,rim:22,scale:1,
    plaque:opponents>4?'sm':'md',plaqueW,plaqueH,seatRx,seatRy,cardScale:1.72,
    seats:seatAngles(opponents).map(angle=>({angle,x:width/2+seatRx*Math.cos(angle)*(Math.abs(Math.cos(angle))<.9?(opponents>4?.72:.56):1),y:cy+seatRy*Math.sin(angle)})),
    me:{angle:Math.PI/2,x:width/2,y:bottom}};
}
