/** Flight colours: distinguishable in light and dark themes and for most colour-vision types, paired with numbers everywhere. */
export const FLIGHT_COLORS = ["#2f7fd1", "#e8590c", "#2b9a4e", "#d6336c", "#7c5ce0", "#0c8599", "#c2255c", "#74a30d", "#f08c00", "#4263eb"];
export const flightColor = (idx: number) => FLIGHT_COLORS[(idx - 1) % FLIGHT_COLORS.length];
