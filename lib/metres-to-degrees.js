/*
https://github.com/eduardogspereira/meters-to-degrees/blob/master/src/index.js

MIT License

Copyright (c) 2018 Eduardo Gustavo Soares Pereira

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 *  Based on https://msi.nga.mil/MSISiteContent/StaticFiles/Calculators/degree.html
 *  and
 *  https://gis.stackexchange.com/questions/75528/understanding-terms-in-length-of-degree-formula/75535#75535
 */

const m1 = 111132.92;
const m2 = -559.82;
const m3 = 1.175;
const m4 = -0.0023;
const p1 = 111412.84;
const p2 = -93.5;
const p3 = 0.118;

const lonLen = latitude =>
  p1 * Math.cos(latitude) +
  p2 * Math.cos(3 * latitude) +
  p3 * Math.cos(5 * latitude);

const latLen = latitude =>
  m1 +
  m2 * Math.cos(2 * latitude) +
  m3 * Math.cos(4 * latitude) +
  m4 * Math.cos(6 * latitude);

const deg2rad = degrees => degrees * (2.0 * Math.PI) / 360;

const lonDegrees = (degrees, meters) => meters / lonLen(deg2rad(degrees));
const latDegrees = (degrees, meters) => meters / latLen(deg2rad(degrees));

exports.lonDegrees = lonDegrees;
exports.latDegrees = latDegrees;