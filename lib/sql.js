module.exports = BaseSQL;

/**
 * Base SQL class
 */
function BaseSQL() {
}

BaseSQL.prototype.query = function() {
    throw new Error('query method should be declared in adapter');
};

BaseSQL.prototype.command = function(sql, callback) {
    return this.query(sql, callback);
};

BaseSQL.prototype.queryOne = function(sql, callback) {
    return this.query(sql, function(err, data) {
        if (err)
            return callback(err);
        callback(err, data[0]);
    });
};

BaseSQL.prototype.table = function(model) {
    return this._models[model].model.schema.tableName(model);
};

BaseSQL.prototype.escapeName = function(name) {
    throw new Error('escapeName method should be declared in adapter');
};

BaseSQL.prototype.tableEscaped = function(model) {
    return this.escapeName(this.table(model));
};

BaseSQL.prototype.define = function(descr) {
    if (!descr.settings)
        descr.settings = {};
    this._models[descr.model.modelName] = descr;
};

BaseSQL.prototype.defineProperty = function(model, prop, params) {
    this._models[model].properties[prop] = params;
};

BaseSQL.prototype.save = function(model, data, callback) {
    var sql = 'UPDATE ' + this.tableEscaped(model) + ' SET ' + this.toFields(model, data) + ' WHERE ' + this.escapeName('id') + ' = ' + data.id;

    this.query(sql, function(err) {
        callback(err);
    });
};

BaseSQL.prototype.exists = function(model, id, callback) {
    id = getInstanceId(id);
    var sql = 'SELECT 1 FROM ' +
            this.tableEscaped(model) + ' WHERE ' + this.escapeName('id') + ' = ' + id + ' LIMIT 1';

    this.query(sql, function(err, data) {
        if (err)
            return callback(err);
        callback(null, data.length === 1);
    });
};

BaseSQL.prototype.findById = function findById(model, id, callback) {
    id = getInstanceId(id);
    var sql = 'SELECT * FROM ' +
            this.tableEscaped(model) + ' WHERE ' + this.escapeName('id') + ' = ' + id + ' LIMIT 1';

    this.query(sql, function(err, data) {
        if (data && data.length === 1) {
            data[0].id = id;
        } else {
            data = [null];
        }
        callback(err, this.fromDatabase(model, data[0]));
    }.bind(this));
};

BaseSQL.prototype.remove = function remove(model, cond, callback) {
    var self = this,
            sql = 'DELETE FROM ' + this.tableEscaped(model) + ' ';
    if (!cond) {
        cond = {};
    }

    if (cond.where) {
        sql += buildWhere(cond.where, self, model);
        this.command(sql, function(err) {
            callback(err);
        });
    } else {
        return callback('Undefined cond.where');
    }
};

BaseSQL.prototype.destroy = function destroy(model, id, callback) {
    var sql = 'DELETE FROM ' +
            this.tableEscaped(model) + ' WHERE ' + this.escapeName('id') + ' = ' + getInstanceId(id);

    this.command(sql, function(err) {
        callback(err);
    });
};

BaseSQL.prototype.destroyAll = function destroyAll(model, callback) {
    this.command('DELETE FROM ' + this.tableEscaped(model), function(err) {
        if (err) {
            return callback(err, []);
        }
        callback(err);
    }.bind(this));
};

BaseSQL.prototype.count = function count(model, callback, cond) {
    var self = this,
            sql = 'SELECT count(*) as cnt FROM ' + self.tableEscaped(model) + ' ';
    if (cond.where) {
        sql += buildWhere(cond.where, self, model);
    }
    self.queryOne(sql, function(err, res) {
        if (err)
            return callback(err);
        callback(err, res && res.cnt);
    });
};

BaseSQL.prototype.updateAttributes = function updateAttrs(model, id, data, cb) {
    data.id = getInstanceId(id);
    this.save(model, data, cb);
};

BaseSQL.prototype.disconnect = function disconnect() {
    this.client.end();
};

BaseSQL.prototype.automigrate = function(cb) {
    var self = this;
    var wait = 0;

    Object.keys(this._models).forEach(function(model) {
        wait += 1;
        self.dropTable(model, function() {
            self.createTable(model, function(err) {
                if (err)
                    console.log(err);
                done();
            });
        });
    });
    if (wait === 0)
        cb();

    function done() {
        if (--wait === 0 && cb) {
            cb();
        }
    }
};

BaseSQL.prototype.dropTable = function(model, cb) {
    this.command('DROP TABLE IF EXISTS ' + this.tableEscaped(model), cb);
};

BaseSQL.prototype.createTable = function(model, indexes, cb) {
    if('function' === typeof indexes) {
        cb = indexes;
        indexes = [];
    }
    this.command('CREATE TABLE ' + this.tableEscaped(model) +
            ' (\n  ' + this.propertiesSQL(model) + '\n)', cb);
};

function buildWhere(conds, adapter, model) {
    var cs = [], or = [],
            self = adapter,
            props = self._models[model].properties;

    Object.keys(conds).forEach(function(key) {
        if (key !== 'or') {
            cs = parseCond(cs, key, props, conds, self);
        } else {
            conds[key].forEach(function(oconds) {
                Object.keys(oconds).forEach(function(okey) {
                    or = parseCond(or, okey, props, oconds, self);
                });
            });
        }
    });

    if (cs.length === 0 && or.length === 0) {
        return '';
    }
    var orop = "";
    if (or.length) {
        orop = ' (' + or.join(' OR ') + ') ';
    }
    return 'WHERE ' + orop + cs.join(' AND ');
}

function parseCond(cs, key, props, conds, self) {
    var keyEscaped = '`' + key.replace(/\./g, '`.`') + '`';
    var val = self.toDatabase(props[key], conds[key]);
    if (conds[key] === null) {
        cs.push(keyEscaped + ' IS NULL');
    } else if (conds[key].constructor.name === 'Object') {
        Object.keys(conds[key]).forEach(function(condType) {
            val = self.toDatabase(props[key], conds[key][condType]);
            var sqlCond = keyEscaped;
            if ((condType === 'inq' || condType === 'nin') && val.length === 0) {
                cs.push(condType === 'inq' ? 0 : 1);
                return true;
            }
            switch (condType) {
                case 'gt':
                    sqlCond += ' > ';
                    break;
                case 'gte':
                    sqlCond += ' >= ';
                    break;
                case 'lt':
                    sqlCond += ' < ';
                    break;
                case 'lte':
                    sqlCond += ' <= ';
                    break;
                case 'between':
                    sqlCond += ' BETWEEN ';
                    break;
                case 'inq':
                case 'in':
                    sqlCond += ' IN ';
                    break;
                case 'nin':
                    sqlCond += ' NOT IN ';
                    break;
                case 'neq':
                case 'ne':
                    sqlCond += ' != ';
                    break;
                case 'regex':
                    sqlCond += ' REGEXP ';
                    break;
                case 'like':
                    sqlCond += ' LIKE ';
                    break;
                case 'nlike':
                    sqlCond += ' NOT LIKE ';
                    break;
                default:
                    sqlCond += ' ' + condType + ' ';
                    break;
            }
            sqlCond += (condType === 'in' || condType === 'inq' || condType === 'nin') ? '(' + val + ')' : val;
            cs.push(sqlCond);
        });

    } else if (/^\//gi.test(conds[key])) {
        var reg = val.toString().split('/');
        cs.push(keyEscaped + ' REGEXP "' + reg[1] + '"');
    } else {
        cs.push(keyEscaped + ' = ' + val);
    }
    return cs;
}

function buildOrderBy(order) {
    if (typeof order === 'string')
        order = [order];
    return 'ORDER BY ' + order.join(', ');
}

function buildLimit(limit, offset) {
    return 'LIMIT ' + (offset ? (offset + ', ' + limit) : limit);
}

/**
 * Normalize id
 *
 * @param {Mixed} id
 */
function getInstanceId(id) {
    if (typeof id === 'object' && id.constructor === Array) {
        id = id[0];
    }
    return id;
}