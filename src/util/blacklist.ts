import minimatch = require('minimatch');

const blacklist = [
  '**\\fomod\\*',
  '**\\readme*',
  '**\\meta.ini',       // Mod Organizer
  '**\\mod.manifest',   // Kingdom Come: Deliverance
];

function isBlacklisted(filePath: string): boolean {
  // TODO: this could become reaaaaly slow as the blacklist gets larger...
  return blacklist.find(pattern => minimatch(filePath, pattern)) !== undefined;
}

export default isBlacklisted;
