/**
 * Initialize User definition
 *
 * @param sequelize DataTypes Instance
 * @returns {PaymentsClass} Returns the Users model
 */

/* istanbul ignore next */
module.exports = function( sequelize, DataTypes ) {
  return sequelize.define(
    'payments', {
      'pool': 'Pool1'
    });
};
