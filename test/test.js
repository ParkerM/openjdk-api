const assert = require('assert');
const fs = require('fs');
const _ = require('underscore');
const Q = require('q');

const GitHubFileCache = require('../app/lib/github_file_cache');
jest.mock('../app/lib/github_file_cache');
// let v2;

describe('v2 API', () => {
  const jdkVersions = ["openjdk8", "openjdk9", "openjdk10", "openjdk11"];
  const releaseTypes = ["nightly", "releases"];

  let v2;
  let cacheMock;
  let getInfoForVersionMock;
  let mockInfoResponse;

  beforeEach(() => {
    getInfoForVersionMock = jest.fn().mockReturnValue(mockInfoResponse);
    cacheMock = new GitHubFileCache();
    cacheMock.getInfoForVersion = getInfoForVersionMock;

    v2 = require('../app/routes/v2')(cacheMock);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // cacheMock.mockClear();
  });

  setUpTestCache();

  function setUpTestCache() {

    if (!fs.existsSync('cache')) {
      fs.mkdirSync('cache');
    }

    function updateCacheTimes(cacheData) {
      for (const cacheEntry in cacheData) {
        if (cacheData[cacheEntry].hasOwnProperty("cacheTime")) {
          cacheData[cacheEntry].cacheTime = Date.now() + 60 * 1000;
        }
      }
    }

    const newCacheData = JSON.parse(fs.readFileSync('./test/asset/cache/newCache.cache.json', {encoding: 'UTF-8'}));
    updateCacheTimes(newCacheData);
    fs.writeFileSync('./cache/newCache.cache.json', JSON.stringify(newCacheData));


    const oldCacheData = JSON.parse(fs.readFileSync('./test/asset/cache/oldCache.cache.json', {encoding: 'UTF-8'}));
    updateCacheTimes(oldCacheData);
    fs.writeFileSync('./cache/oldCache.cache.json', JSON.stringify(oldCacheData));

    console.log('Test cache setup')
  }

  function mockRequest(requestType, buildtype, version, openjdk_impl, os, arch, release, type, heap_size) {
    return {
      params: {
        requestType: requestType,
        buildtype: buildtype,
        version: version,
      },

      query: {
        openjdk_impl: openjdk_impl,
        os: os,
        arch: arch,
        release: release,
        type: type,
        heap_size: heap_size,
      }
    }
  }

  function mockRequestWithSingleQuery(requestType, buildtype, version, queryName, queryValue) {
    const request = mockRequest(requestType, buildtype, version);
    request.query[queryName] = queryValue;
    return request;
  }

  function performRequest(request, doAssert) {
    const codePromise = Q.defer();
    const msgPromise = Q.defer();
    const res = {
      status: (code) => {
        codePromise.resolve(code);
      },
      send: (msg) => {
        msgPromise.resolve(msg);
      },
      json: (msg) => {
        msgPromise.resolve(JSON.stringify(msg));
      },
      redirect: (url) => {
        codePromise.resolve(302);
        msgPromise.resolve(url);
      }
    };

    v2(request, res);

    return Q
    .allSettled([codePromise.promise, msgPromise.promise])
    .then(result => {
      const code = result[0].value;
      const msg = result[1].value;
      doAssert(code, msg);
    });
  }

  function forAllPermutations(doTest) {
    _
    .chain(jdkVersions)
    .each(jdk => {
      _
      .chain(releaseTypes)
      .each(release => {
        doTest(jdk, release);
      });
    });
  }

  function getAllPermutations() {
    const permutations = [];
    jdkVersions.forEach(jdkVersion => {
      releaseTypes.forEach(releaseType => {
        permutations.push([jdkVersion, releaseType]);
      })
    });
    return permutations;
  }

  /*
  TODO: uncomment when fixed
  describe('dinoguns binary request works', function () {
    it("works", function () {
      const request = mockRequest("binary", "nightly", "openjdk8", "hotspot", "linux", "aarch64", "latest", "jdk");
      return performRequest(request, function (code, msg) {
        assert.equal(302, code);
      });
    })
  });
  */

  describe('returns HTTP status code', () => {
    describe('200', () => {
      describe('for simple cases', () => {

        mockInfoResponse = Promise.resolve({});

        it.each(getAllPermutations())('%s %s', (jdk, release) => {
          const request = mockRequest("info", release, jdk);

          return performRequest(request, (code, msg) => {
            expect(code).toEqual(200);
          });
        });
      });
    });

    describe('302', () => {
      describe('for binary redirects', () => {
        forAllPermutations((jdk, release) => {
          const request = mockRequest("binary", release, jdk, "hotspot", "linux", "x64", "latest", "jdk");
          const requestParams = JSON.stringify(request);

          it(`with request: ${requestParams}`, () => {
            return performRequest(request, (code, msg) => {
              assert.strictEqual(code, 302);
            });
          });
        });
      });
    });

    describe('404', () => {
      it('for invalid versions', () => {
        const request = mockRequest("info", "releases", "openjdk50", "hotspot", undefined, undefined, undefined, undefined, undefined);
        return performRequest(request, (code, data) => {
          assert.strictEqual(code, 404);
        });
      });
    });
  });

  // request http://localhost:3000/info/release/openjdk8
  describe('Returns expected properties', () => {
    describe('for binary assets', () => {
      const expectedBinaryProperties = [
        "architecture",
        "binary_link",
        "binary_name",
        "binary_size",
        "binary_type",
        "heap_size",
        "openjdk_impl",
        "os",
        "version",
      ];

      forAllPermutations((jdk, release) => {
        it(`${jdk} ${release}`, () => {
          const request = mockRequest("info", release, jdk);
          return performRequest(request, (code, msg) => {
            assert.strictEqual(code, 200);

            let releases;
            try {
              releases = JSON.parse(msg);
            } catch (e) {
              assert.fail("Failed to read :" + msg)
            }

            _.chain(releases)
            .map(release => release.binaries)
            .flatten()
            .each(binary => {
              _.chain(expectedBinaryProperties)
              .each(property => {
                expect(binary).toHaveProperty(property);
              });
            })
          });
        });
      });
    });
  });

  describe('can filter by properties', () => {
    // request http://localhost:3000/info/release/openjdk8?os=windows
    describe('os', () => {
      checkCanFilterOnProperty("os", "os", "windows");
    });

    // request http://localhost:3000/info/release/openjdk8?openjdk_impl=hotspot
    describe('openjdk_impl', () => {
      checkCanFilterOnProperty("openjdk_impl", "openjdk_impl", "hotspot")
    });

    // request http://localhost:3000/info/release/openjdk8?arch=x64
    describe('arch', () => {
      checkCanFilterOnProperty("arch", "architecture", "x64")
    });

    // request http://localhost:3000/info/release/openjdk8?type=jdk
    describe('type', () => {
      checkCanFilterOnProperty("type", "binary_type", "jdk")
    });

    function checkBinaryProperty(request, returnedPropertyName, propertyValue) {
      return performRequest(request, (code, msg) => {
        assert.strictEqual(code, 200);
        const releases = JSON.parse(msg);
        _.chain(releases)
        .map(release => release.binaries)
        .flatten()
        .each(binary => {
          assert.strictEqual(binary[returnedPropertyName], propertyValue);
        });
      });
    }

    function checkCanFilterOnProperty(propertyName, returnedPropertyName, propertyValue) {
      forAllPermutations((jdk, release) => {
        const request = mockRequestWithSingleQuery("info", release, jdk, propertyName, propertyValue);
        it(`Checking can filter for params: ${jdk} ${release} ${propertyName} ${propertyValue}`, () => {
          return checkBinaryProperty(request, returnedPropertyName, propertyValue);
        })
      });
    }
  });

  describe('filters releases correctly', () => {
    forAllPermutations((jdk, release) => {
      const request = mockRequest("info", release, jdk, "hotspot", "linux", "x64", undefined, "jdk");

      const isRelease = release.indexOf("releases") >= 0;

      it('release is set correctly ' + JSON.stringify(request), () => {
        return performRequest(request, (code, data) => {
          const releases = JSON.parse(data);
          _.chain(releases)
          .each(release => {
            if (release.hasOwnProperty('binaries')) {
              _.chain(releases.binaries)
              .each(binary => {
                const isNightlyRepo = binary.binary_link.indexOf("-nightly") >= 0;
                const isBinaryRepo = binary.binary_link.indexOf("-binaries") >= 0;
                if (isRelease) {
                  assert.strictEqual(isNightlyRepo, false)
                } else {
                  assert.strictEqual(isNightlyRepo || isBinaryRepo, true)
                }
              });
            }

            assert.strictEqual(release.release, isRelease);
          });
        });
      });
    });
  });

  describe('filters heap_size', () => {
    const request = mockRequest("info", "nightly", "openjdk8", undefined, undefined, undefined, undefined, undefined, "large");
    it('only large heaps are returned', () => {
      return performRequest(request, (code, data) => {
        const releases = JSON.parse(data);
        _.chain(releases)
        .each(release => {
          if (release.hasOwnProperty('binaries')) {
            _.chain(releases.binaries)
            .each(binary => {
              assert.strictEqual(binary.binary_link.indexOf("linuxXL") >= 0, true);
              assert.strictEqual(binary.heap_size, "large");
            })
          }
        })
      })
    });
  });

  describe('does not show linuxlh as an os', () => {
    it("is not linuxlh", () => {
      const request = mockRequest("info", "releases", "openjdk8", "openj9", undefined, undefined, undefined, undefined, undefined);
      return performRequest(request, (code, data) => {
        const releases = JSON.parse(data);
        _.chain(releases)
        .each(release => {
          if (release.hasOwnProperty('binaries')) {
            _.chain(releases.binaries)
            .each(binary => {
              assert.notStrictEqual(binary.os.toLowerCase(), "linuxlh");
            })
          }
        })
      });
    })
  });

  describe('latestAssets returns correct results', () => {
    forAllPermutations((jdk, release) => {
      const request = mockRequest("latestAssets", release, jdk, "hotspot", "linux", "x64", undefined, undefined, undefined);

      it("returns correct assets", () => {
        return performRequest(request, (code, data) => {
          const binaries = JSON.parse(data);
          _.chain(binaries)
          .each(binary => {
            assert.strictEqual(binary.openjdk_impl, "hotspot");
            assert.strictEqual(binary.os, "linux");
            assert.strictEqual(binary.architecture, "x64");
          })
        });
      })
    });
  });
});