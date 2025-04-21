import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "util";
import { fromArrayBuffer } from "geotiff";
import * as turf from '@turf/turf';
import { lonDegrees, latDegrees } from './lib/metres-to-degrees';

const CWD = process.cwd();

const UNCLIPPED_DIR = "UNCLIPPED-GEOTIFFS";
const MASK_DIR = "MASK-GEOJSON";
const TEMP_MASK_DIR = "tempmasks";
const EMPTY_DIR = "empty";
const CLIPPED_DIR = "OUTPUT";

const dirs = [UNCLIPPED_DIR, MASK_DIR, TEMP_MASK_DIR, EMPTY_DIR, CLIPPED_DIR];
for (const dir of dirs) {
    const dirPath = path.join(CWD, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
    }
}

const { values, positionals } = parseArgs({
    args: Bun.argv,
    options: {
      offset: {
        type: 'string',
        short: 'o',
        default: "0",
      },
      blend: {
        type: 'string',
        short: 'b',
        default: "0",
      },
      skip: {
        type: 'boolean',
        short: 's',
        default: false,
      },
      prefix: {
        type: 'string',
        short: 'p',
        default: "",
      },
      loglevel: {
        type: 'string',
        short: 'l',
        default: "0",
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
    },
    strict: false,
    allowPositionals: true,
});
const { offset, blend, skip, prefix, loglevel, help } = values;

if (help) {
    console.log("Usage: cliptiff.ts [options]");
    console.log("Options:");
    console.log("  -o, --offset <number>   Mask expand offset in meters (default: 0)");
    console.log("  -b, --blend <number>    Blend clipping pixels in px (default: 0)");
    console.log("  -s, --skip              Skip clipping if no intersection (default: false)");
    console.log("  -p, --prefix <string>   Prefix to distinguish blank output files (default: none)");
    console.log("  -l, --loglevel <number> Set log verbosity level (default: 0)");
    console.log("  -h, --help              Show this help message");
    process.exit(0);
}

const EXPAND_OFFSET = parseInt(offset as string);
if (isNaN(EXPAND_OFFSET)) {
    console.error("Invalid offset value. Must be a number.");
    process.exit(1);
}
const BLEND_PX = parseInt(blend as string);
if (isNaN(BLEND_PX)) {
    console.error("Invalid blend value. Must be a number.");
    process.exit(1);
}
const SKIP_NO_INTERSECT = skip as boolean;
if (typeof SKIP_NO_INTERSECT !== "boolean") {
    console.error("Invalid skip value. Must be a boolean.");
    process.exit(1);
}
const PREFIX = prefix as string;
if (typeof PREFIX !== "string") {
    console.error("Invalid prefix value. Must be a string.");
    process.exit(1);
}
const LOG_LEVEL = parseInt(loglevel as string);
if (isNaN(LOG_LEVEL)) {
    console.error("Invalid loglevel value. Must be a number.");
    process.exit(1);
}

const proc_whicho2o = Bun.spawn(["which", "ogr2ogr"]);
let o2o_path = await new Response(proc_whicho2o.stdout).text();
o2o_path = o2o_path.trim();
if (o2o_path.length < 1) {
  console.error(`"ogr2ogr" not installed or not in PATH`);
  process.exit(1);
}
const proc_whichgw = Bun.spawn(["which", "gdalwarp"]);
let gw_path = await new Response(proc_whichgw.stdout).text();
gw_path = gw_path.trim();
if (gw_path.length < 1) {
  console.error(`"gdalwarp" not installed or not in PATH`);
  process.exit(1);
}
const proc_whichgc = Bun.spawn(["which", "gdal_create"]);
let gc_path = await new Response(proc_whichgc.stdout).text();
gc_path = gc_path.trim();
if (gc_path.length < 1) {
  console.error(`"gdal_create" not installed or not in PATH`);
  process.exit(1);
}

const geotiffFiles = fs.readdirSync(path.join(CWD, UNCLIPPED_DIR))
  .filter(f => f.toLowerCase().endsWith(".tif") || f.toLowerCase().endsWith(".tiff"));
if (geotiffFiles.length === 0) {
  console.error("No geotiff files found in the directory.");
  process.exit(1);
}
for (const file of geotiffFiles) {
    const lower = file.toLowerCase();
    if (!lower.endsWith(".tif") && !lower.endsWith(".tiff")) {
        console.error("Invalid file extension. Only .tif and .tiff files are allowed.");
        process.exit(1);
    }
}
console.log(`Found ${geotiffFiles.length} geotiff files`);

const maskFiles = fs.readdirSync(path.join(CWD, MASK_DIR))
  .filter(f => f.toLowerCase().endsWith(".geojson") || f.toLowerCase().endsWith(".json"));
if (maskFiles.length === 0) {
  console.error("No mask files found in the directory.");
  process.exit(1);
} else if (maskFiles.length > 1) {
  console.error("More than one mask file found in the directory.");
  process.exit(1);
}
const maskFile = maskFiles[0];
if (!maskFile.toLowerCase().endsWith(".geojson") && !maskFile.toLowerCase().endsWith(".json")) {
  console.error("Invalid file extension. Only geojson files are allowed. (.geojson, .json)");
  process.exit(1);
}
const f_maskFile = Bun.file(path.join(path.join(CWD, MASK_DIR), maskFile));
const MASK = await f_maskFile.json();
if (!MASK.features || MASK.features.length === 0) {
    console.error("No features found in the mask file.");
    process.exit(1);
}
const MASK_LAYER_NAME = MASK.name || path.basename(maskFile, path.extname(maskFile));
console.log(`mask loaded: [${MASK_LAYER_NAME}] - ${MASK.features.length} features`);

for (const [index, GEOTIFF_FILENAME] of geotiffFiles.entries()) {
    LOG_LEVEL > 0 && console.log(`Processing "${GEOTIFF_FILENAME}"...`);
    const f = Bun.file(path.join(path.join(CWD, UNCLIPPED_DIR), GEOTIFF_FILENAME));
    const arrayBuffer = await f.arrayBuffer();

    const TIFF = await fromArrayBuffer(arrayBuffer);
    const IMAGE = await TIFF.getImage();
    const RESOLUTION = IMAGE.getResolution();
    const BOUNDING_BOX = IMAGE.getBoundingBox();

    const bboxPoly = turf.bboxPolygon(BOUNDING_BOX as any);
    const intersectingFeature = MASK.features.find((feature: any) =>
      turf.booleanIntersects(bboxPoly, feature)
    );
    
    if (intersectingFeature) {
        LOG_LEVEL > 0 && console.log(`Raster intersects feature: ${intersectingFeature?.properties?.name ?? intersectingFeature?.properties?.Name ?? MASK_LAYER_NAME}`);
        const latDegree = latDegrees(BOUNDING_BOX[1], EXPAND_OFFSET);
        const lonDegree = lonDegrees(BOUNDING_BOX[1], EXPAND_OFFSET);

        const minX = EXPAND_OFFSET !== 0 ? BOUNDING_BOX[0] - lonDegree : BOUNDING_BOX[0];
        const minY = EXPAND_OFFSET !== 0 ? BOUNDING_BOX[1] - latDegree : BOUNDING_BOX[1];
        const maxX = EXPAND_OFFSET !== 0 ? BOUNDING_BOX[2] + lonDegree : BOUNDING_BOX[2];
        const maxY = EXPAND_OFFSET !== 0 ? BOUNDING_BOX[3] + latDegree : BOUNDING_BOX[3];

        LOG_LEVEL > 0 && console.log(`Creating temp mask with extents: ${minX}, ${minY}, ${maxX}, ${maxY}. Using EXPAND_OFFSET=${EXPAND_OFFSET}m`);
        let cmds = [o2o_path, "-nln", "layer", "-f", "GeoJSON", `${CWD}/${TEMP_MASK_DIR}/${GEOTIFF_FILENAME}.geojson`, `${CWD}/${MASK_DIR}/${maskFile}`, "-clipsrc", `${minX}`, `${minY}`, `${maxX}`, `${maxY}`];
        if (EXPAND_OFFSET !== 0) {
            cmds = cmds.concat(["-dialect", "sqlite", "-t_srs", "EPSG:4326", "-s_srs", "EPSG:4326", "-sql", `SELECT ST_Transform(ST_Buffer(ST_Transform(geometry, 3857), ${EXPAND_OFFSET}), 4326) AS geometry, * FROM ${MASK_LAYER_NAME}`]);
        }
        LOG_LEVEL > 1 && console.log(`Running command: ${cmds.join(" ")}`);
        const proc_tempmask = Bun.spawn(cmds, {
          cwd: CWD,
        });
        await proc_tempmask.exited;
        if (proc_tempmask.exitCode !== 0) {
            console.error(`File: ${GEOTIFF_FILENAME}`);
            console.error(`ogr2ogr failed with exit code ${proc_tempmask.exitCode}`);
            process.exit(1);
        }
        LOG_LEVEL > 0 && console.log(`Temp mask created: ${TEMP_MASK_DIR}/${GEOTIFF_FILENAME}.geojson`);

        LOG_LEVEL > 0 && console.log(`Clipping ${GEOTIFF_FILENAME} with mask...`);
        LOG_LEVEL > 0 && console.log(`Using BLEND_PX=${BLEND_PX}px`);
        const clip_cmds = [
            gw_path,
            "-overwrite",
            "-of",
            "GTiff",
            "-tr",
            `${RESOLUTION[0]}`,
            `${RESOLUTION[1]}`,
            "-tap",
            "-cutline",
            `${CWD}/${TEMP_MASK_DIR}/${GEOTIFF_FILENAME}.geojson`,
            "-cblend",
            `${BLEND_PX}`,
            // "-crop_to_cutline",
            // "-dstnodata",
            // "0",
            "-dstalpha",
            "-co",
            "COMPRESS=LZW",
            "-co",
            "TILED=YES",
            "-co",
            "PREDICTOR=2",
            `${CWD}/${UNCLIPPED_DIR}/${GEOTIFF_FILENAME}`,
            `${CWD}/${CLIPPED_DIR}/${GEOTIFF_FILENAME}`,
        ];
        LOG_LEVEL > 1 && console.log(`Running command: ${clip_cmds.join(" ")}`);
        const proc_clip = Bun.spawn(clip_cmds, {
            cwd: CWD,
        });
        await proc_clip.exited;
        if (proc_clip.exitCode !== 0) {
            console.error(`File: ${GEOTIFF_FILENAME}`);
            console.error(`gdalwarp failed with exit code ${proc_clip.exitCode}`);
            process.exit(1);
        }
        console.log(`Created clipped geotiff: ${CLIPPED_DIR}/${GEOTIFF_FILENAME}`);
    } else {
        // no intersection with mask
        if (SKIP_NO_INTERSECT) {
            console.log(`No intersection with mask: ${GEOTIFF_FILENAME}`);
            continue;
        }
        const createEmpty = Bun.spawn([gc_path, "-if", `${CWD}/${UNCLIPPED_DIR}/${GEOTIFF_FILENAME}`, "-bands", "1", "-burn", "0", "-a_nodata", "0", "-ot", "Byte", `${CWD}/${EMPTY_DIR}/${GEOTIFF_FILENAME}`], {
            cwd: CWD,
        });
        await createEmpty.exited;
        if (createEmpty.exitCode !== 0) {
            console.error(`File: ${GEOTIFF_FILENAME}`);
            console.error(`gdal_create failed with exit code ${createEmpty.exitCode}`);
            process.exit(1);
        }
        const setAlpha = Bun.spawn([gw_path, "-overwrite", "-dstalpha", `${CWD}/${EMPTY_DIR}/${GEOTIFF_FILENAME}`, `${CWD}/${CLIPPED_DIR}/${PREFIX}${GEOTIFF_FILENAME}`], {
            cwd: CWD,
        });
        await setAlpha.exited;
        if (setAlpha.exitCode !== 0) {
            console.error(`File: ${GEOTIFF_FILENAME}`);
            console.error(`gdalwarp failed with exit code ${setAlpha.exitCode}`);
            process.exit(1);
        }
        console.log(`Created clipped geotiff: ${CLIPPED_DIR}/${GEOTIFF_FILENAME} (blank)`);
    }
    LOG_LEVEL > 0 && console.log(`Progress: ${index + 1}/${geotiffFiles.length}`);
    if (LOG_LEVEL > 0) {
      const progress = Math.round(((index + 1) / geotiffFiles.length) * 100);
      const bar = (p => {
        const len = 30;
        const fill = Math.round((len * p) / 100);
        return '█'.repeat(fill) + '-'.repeat(len - fill);
      })(progress);
      process.stdout.write(`\r${bar} ${progress}%\n\n`);
    }
}
LOG_LEVEL > 0 && console.log("\nBulk clip process completed.");