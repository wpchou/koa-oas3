import * as koa from 'koa';
import { Config, validateConfig } from './config';
import ChowChow, { ChowError, RequestValidationError, ResponseValidationError } from 'oas3-chow-chow';
import { openapiUI } from './openapi-ui';
import * as jsonfile from 'jsonfile';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
// import * as oasValidator from 'oas-validator';

export { ChowError, RequestValidationError, ResponseValidationError };

type RequestWithBody = koa.BaseRequest & {
  body?: any;
};

export type Oas = {
  request: {
    query?: any;
    header?: any;
    params?: any;
  };
}

declare module 'koa' {
  interface Context {
    oas?: Oas;
  }
}


export function oas(cfg: Partial<Config>): koa.Middleware {

  const config = validateConfig(cfg);
  const { compiled, doc } = compileOas(config);

  const mw: koa.Middleware = async (ctx: koa.Context & { params?: any }, next: () => Promise<any>): Promise<void> => {

    if (config.enableUi && ctx.path === config.endpoint) {
      ctx.body = doc;
      return;
    }

    if (config.enableUi && ctx.path === config.uiEndpoint) {
      ctx.body = openapiUI({
        title: doc.info ? doc.info.title : 'openapi UI',
        url: config.endpoint,
        swaggerUiBundleBasePath: config.swaggerUiBundleBasePath
      });
      return;
    }

    if (!config.validatePaths.some(path => ctx.path.startsWith(path))) {
      // Skip validation if no path matches
      return await next();
    }

    try {
      const validRequest = compiled.validateRequest(ctx.path, {
        method: ctx.request.method,
        header: ctx.request.header,
        query: ctx.request.query,
        path: ctx.params,
        cookie: ctx.cookies,
        body: (ctx.request as RequestWithBody).body,
      });

      // Store coerced values
      ctx.oas = {
        request: {
          query: validRequest.query,
          params: validRequest.path && validRequest.path.params,
          header: validRequest.header
        }
      };

    } catch (err) {
      config.errorHandler(err, ctx);
    }

    await next();

    if (config.validateResponse) {
      try {
        compiled.validateResponse(ctx.path, {
          method: ctx.method,
          status: ctx.status,
          header: ctx.response.header,
          body: ctx.body
        })
      } catch(err) {
        config.errorHandler(err, ctx);
      }
    }
  };
  return mw;
}

function loadFromFile(file?: string) {
    if (!file) {
        throw new Error("Missing file path");
    }
    switch (true) {
        case file.endsWith('.json'): {
            return jsonfile.readFileSync(file);
        }
        case file.endsWith('.yml') || file.endsWith('.yaml'): {
            return yaml.safeLoad(fs.readFileSync(file, 'utf8'));
        }
        default:
            throw new Error('Unsupported file format');
    }
}

function compileOas(config: Config) {
  let openApiObject: any = config.spec || loadFromFile(config.file);
  // if (!oasValidator.validateSync(openApiObject, {})) {
  //   throw new Error('Invalid Openapi document');
  // }
  return {
    compiled: new ChowChow(openApiObject),
    doc: openApiObject,
  };
}
