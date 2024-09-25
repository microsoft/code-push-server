// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ALLOWED_KEY_CHARACTERS_TEST } from "./security";
import * as storageTypes from "../storage/storage";
import * as restTypes from "../types/rest-definitions";
import * as semver from "semver";

import emailValidator = require("email-validator");

module Validation {
  function getStringValidator(maxLength: number = 1000, minLength: number = 0): (value: any) => boolean {
    return function isValidString(value: string): boolean {
      if (typeof value !== "string") {
        return false;
      }

      if (maxLength > 0 && value.length > maxLength) {
        return false;
      }

      return value.length >= minLength;
    };
  }

  export function isValidAppVersionField(appVersion: any): boolean {
    return appVersion && semver.valid(appVersion) !== null;
  }

  function isValidAppVersionRangeField(appVersion: any): boolean {
    return !!semver.validRange(appVersion);
  }

  function isValidBooleanField(val: any): boolean {
    return typeof val === "boolean";
  }

  function isValidLabelField(val: any): boolean {
    return val && val.match(/^v[1-9][0-9]*$/) !== null; //validates if label field confirms to 'v1-v9999...' standard
  }

  function isValidEmailField(email: any): boolean {
    return (
      getStringValidator(/*maxLength=*/ 255, /*minLength=*/ 1)(email) &&
      emailValidator.validate(email) &&
      !/[\\\/\?]/.test(email) && // Forbid URL special characters until #374 is resolved
      !/[\x00-\x1F]/.test(email) && // Control characters
      !/[\x7F-\x9F]/.test(email) &&
      !/#/.test(email) && // The Azure Storage library forbids this in PartitionKeys (in addition to the above)
      !/[ \*]/.test(email) && // Our storage layer currently forbids these characters in PartitionKeys
      !/:/.test(email)
    ); // Forbid colon because we use it as a delimiter for qualified app names
  }

  function isValidTtlField(allowZero: boolean, val: number): boolean {
    return !isNaN(val) && val >= 0 && (val != 0 || allowZero);
  }

  export function isValidKeyField(val: any): boolean {
    return getStringValidator(/*maxLength=*/ 100, /*minLength=*/ 10)(val) && ALLOWED_KEY_CHARACTERS_TEST.test(val);
  }

  function isValidNameField(name: any): boolean {
    return (
      getStringValidator(/*maxLength=*/ 1000, /*minLength=*/ 1)(name) &&
      !/[\\\/\?]/.test(name) && // Forbid URL special characters until #374 is resolved
      !/[\x00-\x1F]/.test(name) && // Control characters
      !/[\x7F-\x9F]/.test(name) &&
      !/:/.test(name)
    ); // Forbid colon because we use it as a delimiter for qualified app names
  }

  export function isValidRolloutField(rollout: any): boolean {
    // rollout is an optional field, or when defined should be a number between 1-100.
    return /^(100|[1-9][0-9]|[1-9])$/.test(rollout);
  }

  const isValidDescriptionField = getStringValidator(/*maxLength=*/ 10000);
  const isValidFriendlyNameField = getStringValidator(/*maxLength=*/ 10000, /*minLength*/ 1);

  export interface ValidationError {
    field: string;
    message: string;
  }

  export interface FieldDefinition {
    [key: string]: (val: any) => boolean;
  }

  export function isValidUpdateCheckRequest(updateCheckRequest: restTypes.UpdateCheckRequest): boolean {
    const fields: FieldDefinition = {
      appVersion: isValidAppVersionField,
      deploymentKey: isValidKeyField,
    };

    const requiredFields = ["appVersion", "deploymentKey"];

    return validate(updateCheckRequest, fields, requiredFields).length === 0;
  }

  export function validateAccessKeyRequest(accessKey: restTypes.AccessKeyRequest, isUpdate: boolean): ValidationError[] {
    const fields: FieldDefinition = {
      friendlyName: isValidFriendlyNameField,
      ttl: isValidTtlField.bind(/*thisArg*/ null, /*allowZero*/ isUpdate),
    };

    let requiredFields: string[] = [];
    if (!isUpdate) {
      fields["name"] = isValidKeyField;
      requiredFields = ["name", "friendlyName"];
    }

    return validate(accessKey, fields, requiredFields);
  }

  export function validateAccount(account: restTypes.Account, isUpdate: boolean): ValidationError[] {
    const fields: FieldDefinition = {
      email: isValidEmailField,
      name: getStringValidator(/*maxLength=*/ 1000, /*minLength=*/ 1),
    };

    let requiredFields: string[] = [];

    if (!isUpdate) {
      requiredFields = ["name"];
    }

    return validate(account, fields, requiredFields);
  }

  export function validateApp(app: restTypes.App | storageTypes.App, isUpdate: boolean): ValidationError[] {
    const fields: FieldDefinition = {
      name: isValidNameField, // During creation/modification, the app's 'name' field will never be qualified with an email
    };

    let requiredFields: string[] = [];

    if (!isUpdate) {
      requiredFields = ["name"];
    }

    return validate(app, fields, requiredFields);
  }

  export function validateDeployment(deployment: restTypes.Deployment, isUpdate: boolean): ValidationError[] {
    const fields: FieldDefinition = {
      name: isValidNameField,
      key: isValidKeyField,
    };

    let requiredFields: string[] = [];

    if (!isUpdate) {
      requiredFields = ["name"];
    }

    return validate(deployment, fields, requiredFields);
  }

  export function validatePackageInfo(packageInfo: restTypes.PackageInfo, allOptional: boolean): ValidationError[] {
    const fields: FieldDefinition = {
      appVersion: isValidAppVersionRangeField,
      description: isValidDescriptionField,
      label: isValidLabelField,
      isDisabled: isValidBooleanField,
      isMandatory: isValidBooleanField,
      rollout: isValidRolloutField,
    };

    let requiredFields: string[] = [];

    if (!allOptional) {
      requiredFields = ["appVersion"];
    }

    return validate(packageInfo, fields, requiredFields);
  }

  function validate(
    obj: any,
    fieldValidators: { [key: string]: (val: any) => boolean },
    requiredFields: string[] = []
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    Object.keys(fieldValidators).forEach((fieldName: string) => {
      const validator: (val: any) => boolean = fieldValidators[fieldName];
      const fieldValue: any = obj[fieldName];
      if (isDefined(fieldValue)) {
        if (!validator(fieldValue)) {
          errors.push({ field: fieldName, message: "Field is invalid" });
        }
      } else {
        const requiredIndex = requiredFields.indexOf(fieldName);
        if (requiredIndex >= 0) {
          errors.push({ field: fieldName, message: "Field is required" });
        }
      }
    });

    return errors;
  }

  export function isDefined(val: any): boolean {
    return val !== null && val !== undefined;
  }
}

export = Validation;
