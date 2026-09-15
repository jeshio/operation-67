/** Unknown measurements use the same fallback for the entire pool, keeping ordering transitive. */
export function rankRooms<T extends {hostRtt:number|null;wave:number;players:number}>(rooms:T[]):T[]{
 const measured=rooms.every(r=>r.hostRtt!==null);
 return [...rooms].sort((a,b)=>(measured?a.hostRtt!-b.hostRtt!:0)||a.wave-b.wave||b.players-a.players);
}
