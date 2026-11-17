// Server-side command gate: second line of defence (UI checks are not trusted).
export const AC_MIN_OFF_MS = 300_000;

export function gateCommand(cmd, ctx) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.id !== 'string') return 'Malformed command';
  if (typeof cmd.on !== 'boolean') return 'on must be boolean';
  if (cmd.type === 'relay') {
    if (!Number.isInteger(cmd.relay) || cmd.relay < 1 || cmd.relay > 31) return 'Relay must be 1-31';
    return null;
  }
  if (cmd.type === 'ac') {
    if (!cmd.on) return null; // disabling is always allowed
    const ac = ctx.ac;
    if (!ac) return 'No AC telemetry: interlock state unknown';
    if (ac.fault || ac.overload || ac.phaseFail || ac.estop) return 'AC protection active';
    if (ctx.offSince && ctx.now - ctx.offSince < AC_MIN_OFF_MS) return 'Compressor minimum OFF-time not elapsed';
    return null;
  }
  return 'Unknown command type';
}

export const controllerOf = (cmd) => (cmd.type === 'ac' ? 'esp32_02' : cmd.relay <= 16 ? 'esp32_01' : 'esp32_02');
